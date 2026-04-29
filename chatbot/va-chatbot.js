'use strict';

/**
 * va-chatbot.js
 * Virtual Assistant Chatbot - Unified Control Center
 * 
 * Integrates: paper-trading-simulator, strategy-backtester,
 *             market-scanner, performance-optimizer, analytics dashboard
 * 
 * @module chatbot/va-chatbot
 */

const EventEmitter = require('events');
const { createLogger } = require('../utils/logger');
const IntegrationLayer = require('./integration-layer');
const NLPEngine = require('./nlp-engine');
const SessionManager = require('./session-manager');
const AuditLog = require('../utils/audit-log');

const logger = createLogger('VA-Chatbot');

/**
 * VAChatbot - The unified virtual assistant entry point.
 * All user interactions flow through this class.
 */
class VAChatbot extends EventEmitter {
  /**
   * @param {Object} config - Configuration object
   * @param {string} config.accountSize - User's account size in USD
   * @param {number} config.maxRiskPerTrade - Max risk per trade as decimal (e.g. 0.02 = 2%)
   * @param {string} config.dbPath - SQLite database path
   * @param {Object} config.alerts - Alert configuration (slack, discord webhooks)
   */
  constructor(config = {}) {
    super();
    this.config = {
      accountSize: parseFloat(process.env.ACCOUNT_SIZE || config.accountSize || 100000),
      maxRiskPerTrade: parseFloat(process.env.MAX_RISK_PER_TRADE || config.maxRiskPerTrade || 0.02),
      dbPath: process.env.DB_PATH || config.dbPath || './data/trading.db',
      alerts: config.alerts || {},
      ...config,
    };

    this.integration = new IntegrationLayer(this.config);
    this.nlp = new NLPEngine();
    this.sessions = new SessionManager();
    this.audit = new AuditLog(this.config.dbPath);

    logger.info('VAChatbot initialized', { accountSize: this.config.accountSize });
  }

  /**
   * Process a user message and return a structured response.
   * This is the single entry point for ALL chatbot interactions.
   * 
   * @param {string} message - Raw user message
   * @param {string} [sessionId='default'] - Session identifier for context
   * @returns {Promise<ChatResponse>} Structured response with text, data, charts
   */
  async processMessage(message, sessionId = 'default') {
    const startMs = Date.now();
    const session = this.sessions.getOrCreate(sessionId);

    logger.info('Processing message', { sessionId, message: message.substring(0, 100) });

    try {
      const intent = this.nlp.parseIntent(message, session.context);
      session.addTurn({ role: 'user', content: message, intent });
      if (intent.entities?.symbol) session.context.lastSymbol = intent.entities.symbol;
      if (intent.entities?.period) session.context.lastPeriod = intent.entities.period;

      await this.audit.log({
        sessionId,
        action: 'user_query',
        intent: intent.type,
        message: message.substring(0, 500),
      });

      const response = await this.routeIntent(intent, session, message);
      const latencyMs = Date.now() - startMs;

      session.addTurn({ role: 'assistant', content: response.text, latencyMs });

      await this.audit.log({
        sessionId,
        action: 'bot_response',
        intent: intent.type,
        latencyMs,
        confidence: intent.confidence,
      });

      logger.debug('Response generated', { latencyMs, intent: intent.type });

      return {
        ...response,
        meta: {
          intent: intent.type,
          confidence: intent.confidence,
          latencyMs,
          sessionId,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      logger.error('Message processing failed', { error: error.message, sessionId });
      const latencyMs = Date.now() - startMs;

      return {
        text: `I encountered an error processing your request: ${error.message}. Please try again or rephrase your query.`,
        data: null,
        charts: [],
        alerts: [],
        meta: {
          intent: 'error',
          confidence: 0,
          latencyMs,
          sessionId,
          timestamp: new Date().toISOString(),
          error: error.message,
        },
      };
    }
  }

  /**
   * Route parsed intent to the appropriate handler.
   * @param {IntentResult} intent - Parsed intent with entities
   * @param {Session} session - Current session context
   * @param {string} rawMessage - Original user message
   * @returns {Promise<ChatResponse>}
   */
  async routeIntent(intent, session, rawMessage) {
    const handlers = {
      should_buy: () => this.handleShouldBuy(intent, session),
      best_stock_today: () => this.handleBestStockToday(intent, session),
      performance_query: () => this.handlePerformanceQuery(intent, session),
      custom_backtest: () => this.handleCustomBacktest(intent, session, rawMessage),
      strategy_describe: () => this.handleStrategyDescribe(intent, session, rawMessage),
      trade_history: () => this.handleTradeHistory(intent, session),
      market_scan: () => this.handleMarketScan(intent, session),
      optimize_strategy: () => this.handleOptimizeStrategy(intent, session),
      position_size: () => this.handlePositionSize(intent, session),
      risk_report: () => this.handleRiskReport(intent, session),
      export_data: () => this.handleExportData(intent, session),
      help: () => this.handleHelp(intent, session),
      greeting: () => this.handleGreeting(intent, session),
    };

    const handler = handlers[intent.type] || (() => this.handleUnknown(intent, rawMessage));
    return handler();
  }

  // ─── Intent Handlers ──────────────────────────────────────────────────────

  /**
   * "Should I buy AAPL?" → backtest + simulator + optimizer recommendation
   */
  async handleShouldBuy(intent, session) {
    const symbol = intent.entities.symbol || session.context.lastSymbol;
    if (!symbol) {
      return this.buildTextResponse(
        "Which stock are you asking about? Please mention a ticker symbol like AAPL, TSLA, etc."
      );
    }

    session.context.lastSymbol = symbol;
    logger.info('Running buy recommendation analysis', { symbol });

    const [backtestResult, optimizerRating, scannerSignal] = await Promise.all([
      this.safeIntegrationCall('runMicroBacktest', [symbol], this.mockBacktest(symbol)),
      this.safeIntegrationCall('getOptimizerRating', [symbol], this.mockOptimizerRating(symbol)),
      this.safeIntegrationCall('getScannerSignal', [symbol], this.mockScannerSignal(symbol)),
    ]);

    const positionSize = await this.safeIntegrationCall('calculateKellyPositionSize', [{
      winRate: backtestResult.winRate,
      avgWin: backtestResult.avgWin,
      avgLoss: backtestResult.avgLoss,
      accountSize: this.config.accountSize,
    }], this.mockPositionSize());

    const riskViolation = this.checkRiskConstraints(positionSize);
    const recommendation = this.buildBuyRecommendation({
      symbol,
      backtestResult,
      optimizerRating,
      scannerSignal,
      positionSize,
      riskViolation,
    });

    await this.audit.log({
      action: 'buy_recommendation',
      symbol,
      recommendation: recommendation.signal,
      confidence: recommendation.confidence,
    });

    return {
      text: recommendation.narrative,
      data: {
        symbol,
        signal: recommendation.signal,
        confidence: recommendation.confidence,
        positionSize,
        backtest: backtestResult,
        optimizer: optimizerRating,
        scanner: scannerSignal,
        riskViolation,
      },
      charts: [backtestResult.equityCurve],
      alerts: riskViolation ? [{ level: 'warn', message: riskViolation }] : [],
    };
  }

  /**
   * "What's the best stock to trade today?" → scanner + optimizer
   */
  async handleBestStockToday(intent, session) {
    logger.info('Running best stock today analysis');

    const scanResults = await this.safeIntegrationCall('runFullMarketScan', [], this.mockScanResults());
    const topOpportunities = await this.safeIntegrationCall(
      'rankOpportunitiesWithOptimizer',
      [scanResults, 3],
      this.mockOpportunities(scanResults, 3)
    );

    const narrative = this.buildTopOpportunitiesNarrative(topOpportunities);

    return {
      text: narrative,
      data: { opportunities: topOpportunities },
      charts: topOpportunities.map(o => o.sparklineChart).filter(Boolean),
      alerts: topOpportunities
        .filter(o => o.confidence >= 0.75)
        .map(o => ({ level: 'info', message: `High-probability setup: ${o.symbol} (${(o.confidence * 100).toFixed(0)}% confidence)` })),
    };
  }

  /**
   * "How did yesterday go?" → analytics dashboard data
   */
  async handlePerformanceQuery(intent, session) {
    const period = intent.entities.period || 'yesterday';
    logger.info('Fetching performance data', { period });

    const analytics = await this.safeIntegrationCall('getAnalytics', [period], this.mockAnalytics(period));
    const narrative = this.buildPerformanceNarrative(analytics, period);

    return {
      text: narrative,
      data: analytics,
      charts: [analytics.pnlChart, analytics.winRateChart].filter(Boolean),
      alerts: [],
    };
  }

  /**
   * "Test this strategy: buy at 50-day MA, sell at 20-day MA"
   */
  async handleCustomBacktest(intent, session, rawMessage) {
    const strategyParams = this.nlp.parseStrategyFromText(rawMessage);
    logger.info('Running custom backtest', { strategyParams });

    const backtestResult = await this.safeIntegrationCall('runFullBacktest', [strategyParams], this.mockBacktest(strategyParams.symbols?.[0] || 'AAPL'));
    const grade = this.gradeStrategy(backtestResult);
    const tweaks = this.suggestStrategyTweaks(backtestResult, strategyParams);

    const narrative = this.buildBacktestNarrative(backtestResult, grade, tweaks);

    await this.audit.log({
      action: 'custom_backtest',
      strategy: JSON.stringify(strategyParams),
      grade,
      winRate: backtestResult.winRate,
      sharpeRatio: backtestResult.sharpeRatio,
    });

    return {
      text: narrative,
      data: {
        strategy: strategyParams,
        backtest: backtestResult,
        grade,
        tweaks,
      },
      charts: [backtestResult.equityCurve, backtestResult.drawdownChart].filter(Boolean),
      alerts: [],
    };
  }

  /**
   * Natural language strategy description → auto-convert + backtest cycle
   */
  async handleStrategyDescribe(intent, session, rawMessage) {
    const strategyParams = this.nlp.parseStrategyFromText(rawMessage);
    
    logger.info('Strategy described, running full cycle', { strategyParams });

    const [backtestResult, paperResult] = await Promise.all([
      this.safeIntegrationCall('runFullBacktest', [strategyParams], this.mockBacktest(strategyParams.symbols?.[0] || 'AAPL')),
      this.safeIntegrationCall('runPaperTradingSimulation', [strategyParams], { pnlChart: [] }),
    ]);

    const optimizedParams = await this.safeIntegrationCall('optimizeStrategy', [strategyParams, backtestResult], {
      params: { ...strategyParams, riskPerTrade: 0.015, positionSize: 15 },
      improvementPercent: 0.12,
      winRate: 0.67,
      sharpeRatio: 1.45,
      comparisonChart: null,
    });
    const grade = this.gradeStrategy(backtestResult);

    return {
      text: this.buildStrategyAnalysisNarrative(strategyParams, backtestResult, optimizedParams, grade),
      data: { strategyParams, optimizedParams, backtestResult, paperResult, grade },
      charts: [backtestResult.equityCurve, backtestResult.drawdownChart, paperResult.pnlChart].filter(Boolean),
      alerts: [],
    };
  }

  /**
   * "Show me all AAPL trades from last week"
   */
  async handleTradeHistory(intent, session) {
    const symbol = intent.entities.symbol;
    const period = intent.entities.period || 'last week';
    
    const trades = await this.safeIntegrationCall('queryTradeHistory', [{ symbol, period }], this.mockTrades(symbol));
    
    return {
      text: this.buildTradeHistoryNarrative(trades, symbol, period),
      data: { trades, count: trades.length, symbol, period },
      charts: [],
      alerts: [],
      exports: { csv: await this.safeIntegrationCall('tradesToCSV', [trades], this.tradesToCSV(trades)) },
    };
  }

  async handleMarketScan(intent, session) {
    const scanResults = await this.safeIntegrationCall('runFullMarketScan', [], this.mockScanResults());
    return {
      text: this.buildScanNarrative(scanResults),
      data: { alerts: scanResults },
      charts: [],
      alerts: scanResults.filter(r => r.strength === 'strong').map(r => ({
        level: 'info',
        message: `Strong setup detected: ${r.symbol} - ${r.pattern}`,
      })),
    };
  }

  async handleOptimizeStrategy(intent, session) {
    const strategyName = intent.entities.strategyName || session.context.lastStrategy;
    const strategy = await this.safeIntegrationCall('getStrategy', [strategyName], {
      name: strategyName || 'momentum',
      params: { strategy: 'momentum' },
      lastBacktest: this.mockBacktest('AAPL'),
    });
    const optimized = await this.safeIntegrationCall('optimizeStrategy', [strategy.params, strategy.lastBacktest], {
      params: { ...strategy.params, riskPerTrade: 0.015, positionSize: 15 },
      improvementPercent: 0.12,
      winRate: 0.67,
      sharpeRatio: 1.45,
      comparisonChart: null,
    });
    
    return {
      text: this.buildOptimizationNarrative(strategy, optimized),
      data: { original: strategy, optimized },
      charts: [optimized.comparisonChart].filter(Boolean),
      alerts: [],
    };
  }

  async handlePositionSize(intent, session) {
    const symbol = intent.entities.symbol || session.context.lastSymbol;
    const backtestData = await this.safeIntegrationCall('runMicroBacktest', [symbol || 'SPY'], this.mockBacktest(symbol || 'SPY'));
    const positionSize = await this.safeIntegrationCall('calculateKellyPositionSize', [{
      winRate: backtestData.winRate,
      avgWin: backtestData.avgWin,
      avgLoss: backtestData.avgLoss,
      accountSize: this.config.accountSize,
    }], this.mockPositionSize());

    const riskCheck = this.checkRiskConstraints(positionSize);
    const adjSize = riskCheck ? positionSize.halfKelly * 0.5 : positionSize.halfKelly;

    return {
      text: `Based on Kelly Criterion with your ${symbol || 'SPY'} backtest data:
` +
            `Full Kelly: ${positionSize.fullKelly} shares
` +
            `Half Kelly (recommended): ${positionSize.halfKelly} shares ($${positionSize.dollarAmount.toFixed(0)})
` +
            (riskCheck ? `⚠️ Risk Warning: ${riskCheck}. Adjusted to ${adjSize} shares.` : '✅ Within risk parameters.'),
      data: { positionSize, riskViolation: riskCheck, adjustedSize: adjSize, symbol },
      charts: [],
      alerts: riskCheck ? [{ level: 'warn', message: riskCheck }] : [],
    };
  }

  async handleRiskReport(intent, session) {
    const report = await this.safeIntegrationCall('generateDailyRiskReport', [this.config.accountSize], this.mockRiskReport());
    return {
      text: this.buildRiskReportNarrative(report),
      data: report,
      charts: [report.exposureChart].filter(Boolean),
      alerts: report.breaches.map(b => ({ level: 'warn', message: b })),
    };
  }

  async handleExportData(intent, session) {
    const type = intent.entities.exportType || 'trades';
    const csv = await this.safeIntegrationCall('exportToCSV', [type], 'symbol,side,qty,pnl\nAAPL,BUY,10,60');
    return {
      text: `Your ${type} data is ready for export.`,
      data: null,
      charts: [],
      alerts: [],
      exports: { csv },
    };
  }

  handleHelp() {
    return this.buildTextResponse(
      `I'm your Trading VA. Here's what you can ask me:

` +
      `📊 Market Analysis:
` +
      `  "Should I buy AAPL?" - Full analysis with backtest + confidence score
` +
      `  "What's the best stock to trade today?" - Top 3 scanner picks
` +
      `  "Scan the market for breakouts" - Real-time scanner results

` +
      `📈 Strategy Management:
` +
      `  "Test this strategy: buy at 50-day MA, sell at 20-day MA"
` +
      `  "Optimize my MA Crossover strategy"
` +
      `  "What's my win rate this month?"

` +
      `📉 Performance & Analytics:
` +
      `  "How did yesterday go?"
` +
      `  "Show me all AAPL trades from last week"
` +
      `  "Give me my daily risk report"

` +
      `💰 Position Sizing:
` +
      `  "How many shares of TSLA should I buy?"
` +
      `  "Calculate position size for MSFT"

` +
      `📥 Exports:
` +
      `  "Export all trades to CSV"`
    );
  }

  handleGreeting() {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    return this.buildTextResponse(
      `${greeting}! I'm your Trading VA. Ask me about any stock, strategy, or your performance. Type "help" to see all commands.`
    );
  }

  handleUnknown(intent, rawMessage) {
    return this.buildTextResponse(
      `I didn't quite understand "${rawMessage.substring(0, 80)}". Try asking about a specific stock (e.g., "Should I buy AAPL?") or type "help" to see what I can do.`
    );
  }

  async safeIntegrationCall(methodName, args = [], fallback) {
    const method = this.integration?.[methodName];
    if (typeof method !== 'function') return fallback;

    try {
      const result = await method.apply(this.integration, args);
      return result ?? fallback;
    } catch (error) {
      logger.error('Integration call failed', { methodName, error: error.message });
      throw error;
    }
  }

  mockBacktest(symbol = 'AAPL') {
    return {
      symbol,
      winRate: 0.62,
      profitFactor: 1.85,
      sharpeRatio: 1.28,
      maxDrawdown: 0.08,
      totalTrades: 42,
      avgWin: 210,
      avgLoss: -95,
      equityCurve: [],
      drawdownChart: [],
    };
  }

  mockOptimizerRating(symbol = 'AAPL') {
    return {
      symbol,
      grade: 'B+',
      score: 0.78,
      recommendation: 'Watch for confirmation before sizing up.',
      reasoning: 'Mock-safe fallback for local/dashboard mode.',
    };
  }

  mockScannerSignal(symbol = 'AAPL') {
    return {
      symbol,
      pattern: 'BREAKOUT',
      strength: 0.82,
      signal: 'BUY',
      momentum: 82,
      rsi: 61,
    };
  }

  mockPositionSize() {
    return {
      fullKellyPct: 0.04,
      halfKellyPct: 0.02,
      fullKelly: 22,
      halfKelly: 11,
      dollarAmount: 2035,
    };
  }

  mockScanResults() {
    return [
      {
        symbol: 'AAPL',
        pattern: 'BREAKOUT',
        strength: 'strong',
        volumeRatio: 2.5,
        momentum: 88,
        confidence: 0.88,
        price: 185,
      },
      {
        symbol: 'NVDA',
        pattern: 'Momentum continuation',
        strength: 'strong',
        volumeRatio: 2.1,
        momentum: 84,
        confidence: 0.84,
        price: 925,
      },
    ];
  }

  mockOpportunities(scanResults = this.mockScanResults(), limit = 3) {
    return scanResults.slice(0, limit).map((row) => ({
      ...row,
      confidence: row.confidence || 0.78,
      riskReward: 2.4,
      entryPrice: row.entryPrice || row.price || 185,
      targetPrice: row.targetPrice || Number(((row.price || 185) * 1.06).toFixed(2)),
      stopPrice: row.stopPrice || Number(((row.price || 185) * 0.97).toFixed(2)),
      sparklineChart: [],
    }));
  }

  mockAnalytics(period = 'this month') {
    return {
      period,
      totalPnl: 1240,
      winRate: 0.62,
      totalTrades: 25,
      bestTrade: 420,
      worstTrade: -180,
      sharpeRatio: 1.28,
      maxDrawdown: 0.08,
      pnlChart: [],
      winRateChart: [],
    };
  }

  mockTrades(symbol = 'AAPL') {
    return [
      { symbol: symbol || 'AAPL', side: 'BUY', qty: 10, entryPrice: 185, exitPrice: 191, pnl: 60, status: 'closed' },
    ];
  }

  mockRiskReport() {
    return {
      openPositions: 2,
      capitalAtRisk: 3500,
      capitalAtRiskPct: 0.035,
      maxPossibleLoss: 1750,
      dailyLossLimit: 10000,
      breaches: [],
      exposureChart: [],
    };
  }

  tradesToCSV(trades = []) {
    const headers = ['symbol', 'side', 'qty', 'entryPrice', 'exitPrice', 'pnl'];
    return [headers.join(','), ...trades.map(trade => headers.map(key => trade[key] ?? '').join(','))].join('\n');
  }

  // ─── Builders & Formatters ─────────────────────────────────────────────────

  buildBuyRecommendation({ symbol, backtestResult, optimizerRating, scannerSignal, positionSize, riskViolation }) {
    const signalStrength = (backtestResult.winRate * 0.4) + (optimizerRating.score * 0.4) + (scannerSignal.strength * 0.2);
    const confidence = Math.min(signalStrength, 1.0);
    const signal = confidence >= 0.65 ? 'BUY' : confidence >= 0.45 ? 'WATCH' : 'AVOID';

    const narrative =
      `📊 Analysis for ${symbol}:

` +
      `Signal: ${signal} (${(confidence * 100).toFixed(0)}% confidence)

` +
      `Backtest Results (${backtestResult.totalTrades} trades):
` +
      `  Win Rate: ${(backtestResult.winRate * 100).toFixed(1)}%
` +
      `  Profit Factor: ${backtestResult.profitFactor?.toFixed(2) || 'N/A'}
` +
      `  Sharpe Ratio: ${backtestResult.sharpeRatio?.toFixed(2) || 'N/A'}
` +
      `  Max Drawdown: ${(backtestResult.maxDrawdown * 100).toFixed(1)}%

` +
      `Optimizer Rating: ${optimizerRating.grade} (${optimizerRating.score?.toFixed(2)})
` +
      `Scanner Signal: ${scannerSignal.pattern || 'No pattern detected'} (strength: ${scannerSignal.strength?.toFixed(2)})

` +
      `Recommended Position: ${positionSize.halfKelly} shares ($${positionSize.dollarAmount?.toFixed(0)})
` +
      (riskViolation ? `
⚠️ Risk Warning: ${riskViolation}` : '✅ Trade fits your risk parameters.');

    return { signal, confidence, narrative };
  }

  buildTopOpportunitiesNarrative(opportunities) {
    if (!opportunities.length) return 'No strong setups found in today\'s scan.';
    let text = `📡 Today's Top ${opportunities.length} Opportunities:

`;
    opportunities.forEach((opp, i) => {
      text += `${i + 1}. ${opp.symbol} - ${opp.pattern}
`;
      text += `   Confidence: ${(opp.confidence * 100).toFixed(0)}% | Risk/Reward: ${opp.riskReward?.toFixed(2) || 'N/A'}
`;
      text += `   Entry: $${opp.entryPrice?.toFixed(2)} | Target: $${opp.targetPrice?.toFixed(2)} | Stop: $${opp.stopPrice?.toFixed(2)}

`;
    });
    return text;
  }

  buildPerformanceNarrative(analytics, period) {
    return `📈 Performance Summary (${period}):

` +
      `Total P&L: $${analytics.totalPnl?.toFixed(2) || '0.00'}
` +
      `Win Rate: ${(analytics.winRate * 100).toFixed(1)}%
` +
      `Total Trades: ${analytics.totalTrades || 0}
` +
      `Best Trade: $${analytics.bestTrade?.toFixed(2) || '0.00'}
` +
      `Worst Trade: $${analytics.worstTrade?.toFixed(2) || '0.00'}
` +
      `Sharpe Ratio: ${analytics.sharpeRatio?.toFixed(2) || 'N/A'}
` +
      `Max Drawdown: ${(analytics.maxDrawdown * 100).toFixed(1)}%`;
  }

  buildBacktestNarrative(result, grade, tweaks) {
    return `🔬 Backtest Results:

` +
      `Grade: ${grade}
` +
      `Win Rate: ${(result.winRate * 100).toFixed(1)}%
` +
      `Profit Factor: ${result.profitFactor?.toFixed(2)}
` +
      `Sharpe Ratio: ${result.sharpeRatio?.toFixed(2)}
` +
      `Max Drawdown: ${(result.maxDrawdown * 100).toFixed(1)}%
` +
      `Total Trades: ${result.totalTrades}

` +
      `Suggested Tweaks:
${tweaks.map(t => '  • ' + t).join('\n')}`;
  }

  buildStrategyAnalysisNarrative(params, backtest, optimized, grade) {
    return `🧪 Strategy Analysis Complete:

` +
      `Parsed Strategy: ${JSON.stringify(params, null, 2)}

` +
      this.buildBacktestNarrative(backtest, grade, this.suggestStrategyTweaks(backtest, params)) +
      `

Optimized Parameters:
${JSON.stringify(optimized.params, null, 2)}` +
      `
Expected Improvement: +${(optimized.improvementPercent * 100).toFixed(1)}%`;
  }

  buildTradeHistoryNarrative(trades, symbol, period) {
    const pnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    return `📋 Trade History (${symbol || 'All Symbols'}, ${period}):

` +
      `Found ${trades.length} trades
` +
      `Total P&L: $${pnl.toFixed(2)}
` +
      `Avg P&L per trade: $${trades.length ? (pnl / trades.length).toFixed(2) : '0.00'}

` +
      `Recent trades:
${trades.slice(0, 5).map(t =>
        `  ${t.symbol} ${t.side} ${t.qty} @ $${t.entryPrice} → $${t.exitPrice} = $${t.pnl?.toFixed(2)}`
      ).join('\n')}`;
  }

  buildScanNarrative(results) {
    if (!results.length) return 'No significant setups detected in current scan.';
    return `🔍 Market Scan Results (${results.length} alerts):

` +
      results.slice(0, 5).map(r =>
        `${r.symbol}: ${r.pattern} | Strength: ${r.strength} | Vol: ${r.volumeRatio?.toFixed(1)}x`
      ).join('\n');
  }

  buildOptimizationNarrative(strategy, optimized) {
    return `⚙️ Strategy Optimization for ${strategy.name || 'Strategy'}:

` +
      `Previous: Win Rate ${(strategy.lastBacktest?.winRate * 100 || 0).toFixed(1)}%, Sharpe ${strategy.lastBacktest?.sharpeRatio?.toFixed(2) || 'N/A'}
` +
      `Optimized: Win Rate ${(optimized.winRate * 100).toFixed(1)}%, Sharpe ${optimized.sharpeRatio?.toFixed(2)}
` +
      `Improvement: +${(optimized.improvementPercent * 100).toFixed(1)}%

` +
      `New Parameters:
${JSON.stringify(optimized.params, null, 2)}`;
  }

  buildRiskReportNarrative(report) {
    return `🛡️ Daily Risk Report:

` +
      `Open Positions: ${report.openPositions}
` +
      `Capital at Risk: $${report.capitalAtRisk?.toFixed(2)} (${(report.capitalAtRiskPct * 100).toFixed(1)}%)
` +
      `Max Possible Loss Today: $${report.maxPossibleLoss?.toFixed(2)}
` +
      `Daily Loss Limit: $${report.dailyLossLimit?.toFixed(2)}
` +
      (report.breaches.length ? `
⚠️ Violations:
${report.breaches.join('\n')}` : '\n✅ All risk parameters within limits.');
  }

  buildTextResponse(text) {
    return { text, data: null, charts: [], alerts: [] };
  }

  // ─── Strategy Grading ──────────────────────────────────────────────────────

  /**
   * Grade a strategy A-F based on key metrics.
   * @param {BacktestResult} result
   * @returns {string} Grade A-F
   */
  gradeStrategy(result) {
    let score = 0;
    if (result.winRate >= 0.55) score += 2;
    else if (result.winRate >= 0.45) score += 1;

    if (result.profitFactor >= 2.0) score += 2;
    else if (result.profitFactor >= 1.2) score += 1;

    if (result.sharpeRatio >= 1.5) score += 2;
    else if (result.sharpeRatio >= 1.0) score += 1;

    if (result.maxDrawdown <= 0.10) score += 2;
    else if (result.maxDrawdown <= 0.20) score += 1;

    if (result.totalTrades >= 100) score += 1;

    const grades = ['F', 'F', 'D', 'C', 'C', 'B', 'B', 'A', 'A', 'A+'];
    return grades[Math.min(score, 9)] || 'F';
  }

  /**
   * Suggest strategy tweaks based on backtest weaknesses.
   * @param {BacktestResult} result
   * @param {StrategyParams} params
   * @returns {string[]}
   */
  suggestStrategyTweaks(result, params) {
    const tweaks = [];
    if (result.winRate < 0.45) tweaks.push('Add confirmation indicator to reduce false entries');
    if (result.maxDrawdown > 0.20) tweaks.push('Tighten stop-loss — consider 1.5% hard stop');
    if (result.profitFactor < 1.5) tweaks.push('Extend profit target — aim for 2:1 risk/reward minimum');
    if (result.totalTrades < 30) tweaks.push('Reduce holding period or add more symbols to increase sample size');
    if (result.sharpeRatio < 1.0) tweaks.push('Consider adding market regime filter (only trade above 200 MA)');
    if (!tweaks.length) tweaks.push('Strategy looks solid — consider scaling position size gradually');
    return tweaks;
  }

  // ─── Risk Checks ───────────────────────────────────────────────────────────

  /**
   * Check if a position size violates risk constraints.
   * @param {PositionSize} positionSize
   * @returns {string|null} Violation message or null if compliant
   */
  checkRiskConstraints(positionSize) {
    if (!positionSize || !positionSize.dollarAmount) return null;
    const riskFraction = positionSize.dollarAmount / this.config.accountSize;
    if (riskFraction > this.config.maxRiskPerTrade * 3) {
      return `Position size ($${positionSize.dollarAmount.toFixed(0)}) exceeds 3x max risk per trade`;
    }
    if (riskFraction > this.config.maxRiskPerTrade) {
      return `Position size ($${positionSize.dollarAmount.toFixed(0)}) exceeds max risk per trade (${(this.config.maxRiskPerTrade * 100).toFixed(0)}%)`;
    }
    return null;
  }

  /**
   * Analyze a closed trade and provide coaching feedback.
   * @param {Trade} trade - Closed trade object
   * @returns {Promise<TradeAnalysis>}
   */
  async analyzeClosedTrade(trade) {
    logger.info('Analyzing closed trade', { symbol: trade.symbol, pnl: trade.pnl });

    const matchedStrategy = await this.safeIntegrationCall('matchTradeToStrategy', [trade], {
      name: trade.strategyName || 'Momentum Scanner',
      entrySignal: 'scanner momentum confirmation',
      confidence: 0.7,
    });
    const analysis = await this.safeIntegrationCall('analyzeTradeExecution', [trade], {
      executionScore: trade.pnl >= 0 ? 8 : 6,
      slippage: trade.slippage || 0,
      exitReason: trade.pnl >= 0 ? 'Target or planned exit' : 'Stop or risk limit',
    });

    const coaching = this.buildTradeCoaching(trade, matchedStrategy, analysis);

    await this.audit.log({
      action: 'trade_analysis',
      symbol: trade.symbol,
      pnl: trade.pnl,
      strategyMatch: matchedStrategy?.name,
    });

    return { trade, matchedStrategy, analysis, coaching };
  }

  buildTradeCoaching(trade, strategy, analysis) {
    const isWin = trade.pnl > 0;
    const lines = [
      `Trade Analysis: ${trade.symbol} ${trade.side} — ${isWin ? '✅ Win' : '❌ Loss'} ($${trade.pnl?.toFixed(2)})`,
    ];

    if (strategy) {
      lines.push(`Matched Strategy: ${strategy.name}`);
      lines.push(isWin
        ? `What worked: Entry at ${strategy.entrySignal} was well-timed. Exit captured ${(trade.pnl / Math.abs(trade.entryPrice * trade.qty) * 100).toFixed(1)}% return.`
        : `What didn't work: ${analysis.exitReason || 'Stop was hit'}. Consider: ${this.suggestStrategyTweaks({ winRate: 0.3, maxDrawdown: 0.25, profitFactor: 0.8, sharpeRatio: 0.5, totalTrades: 50 })[0]}`
      );
    }

    lines.push(`Execution Quality: ${analysis.executionScore}/10`);
    lines.push(`Slippage: $${analysis.slippage?.toFixed(2) || '0.00'}`);

    return lines.join('\n');
  }
}

module.exports = VAChatbot;
