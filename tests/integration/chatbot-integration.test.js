'use strict';

/**
 * chatbot-integration.test.js
 * Integration tests: chatbot ↔ NLP ↔ session manager ↔ integration layer
 * Tests the full message processing pipeline with mocked trading modules.
 * @module tests/integration/chatbot-integration
 */

jest.mock('../../chatbot/integration-layer');
jest.mock('../../utils/audit-log');

const VAChatbot = require('../../chatbot/va-chatbot');
const NLPEngine = require('../../chatbot/nlp-engine');
const SessionManager = require('../../chatbot/session-manager');
const IntegrationLayer = require('../../chatbot/integration-layer');
const AuditLog = require('../../utils/audit-log');

// ─── Mock Setup ─────────────────────────────────────────────────────────────

function setupMocks() {
  IntegrationLayer.prototype.runMicroBacktest = jest.fn().mockResolvedValue({
    winRate: 0.58, profitFactor: 1.7, sharpeRatio: 1.1,
    maxDrawdown: 0.14, totalTrades: 120, avgWin: 180, avgLoss: 90, equityCurve: [],
  });
  IntegrationLayer.prototype.getOptimizerRating = jest.fn().mockResolvedValue({ grade: 'B', score: 0.70 });
  IntegrationLayer.prototype.getScannerSignal = jest.fn().mockResolvedValue({ pattern: 'MOMENTUM', strength: 0.75 });
  IntegrationLayer.prototype.calculateKellyPositionSize = jest.fn().mockReturnValue({
    halfKelly: 12, fullKelly: 24, dollarAmount: 2220, halfKellyFraction: 0.022,
  });
  IntegrationLayer.prototype.runFullMarketScan = jest.fn().mockResolvedValue([
    { symbol: 'AAPL', pattern: 'BREAKOUT', strength: 0.88, volumeRatio: 2.3, currentPrice: 185 },
    { symbol: 'NVDA', pattern: 'MOMENTUM', strength: 0.82, volumeRatio: 1.9, currentPrice: 500 },
    { symbol: 'TSLA', pattern: 'OVERSOLD', strength: 0.71, volumeRatio: 1.5, currentPrice: 210 },
  ]);
  IntegrationLayer.prototype.rankOpportunitiesWithOptimizer = jest.fn().mockResolvedValue([
    { symbol: 'AAPL', pattern: 'BREAKOUT', confidence: 0.87, riskReward: 2.8,
      entryPrice: 185, targetPrice: 196, stopPrice: 179 },
    { symbol: 'NVDA', pattern: 'MOMENTUM', confidence: 0.76, riskReward: 2.2,
      entryPrice: 500, targetPrice: 525, stopPrice: 488 },
  ]);
  IntegrationLayer.prototype.getAnalytics = jest.fn().mockResolvedValue({
    totalPnl: 2340.75, winRate: 0.63, totalTrades: 52,
    maxDrawdown: 0.09, sharpeRatio: 1.5, bestTrade: 450, worstTrade: -220,
    pnlChart: { type: 'line', data: [] },
  });
  IntegrationLayer.prototype.runFullBacktest = jest.fn().mockResolvedValue({
    winRate: 0.60, profitFactor: 1.8, sharpeRatio: 1.2,
    maxDrawdown: 0.12, totalTrades: 150, avgWin: 200, avgLoss: 100, equityCurve: [],
  });
  IntegrationLayer.prototype.runPaperTradingSimulation = jest.fn().mockResolvedValue({ pnlChart: null });
  IntegrationLayer.prototype.optimizeStrategy = jest.fn().mockResolvedValue({
    params: { fastPeriod: 22, slowPeriod: 55 }, improvementPercent: 0.12,
    winRate: 0.63, sharpeRatio: 1.35, comparisonChart: null,
  });
  IntegrationLayer.prototype.queryTradeHistory = jest.fn().mockResolvedValue([
    { symbol: 'AAPL', side: 'BUY', qty: 10, entryPrice: 185, exitPrice: 192, pnl: 70, status: 'closed', timestamp: '2026-04-20T10:00:00Z' },
    { symbol: 'AAPL', side: 'BUY', qty: 5, entryPrice: 183, exitPrice: 180, pnl: -15, status: 'closed', timestamp: '2026-04-19T14:00:00Z' },
  ]);
  IntegrationLayer.prototype.tradesToCSV = jest.fn().mockReturnValue('symbol,side,qty\nAAPL,BUY,10');
  IntegrationLayer.prototype.generateDailyRiskReport = jest.fn().mockResolvedValue({
    openPositions: 3, capitalAtRisk: 4500, capitalAtRiskPct: 0.045,
    maxPossibleLoss: 2000, dailyLossLimit: 10000, breaches: [], generatedAt: new Date().toISOString(),
  });
  IntegrationLayer.prototype.exportToCSV = jest.fn().mockResolvedValue('symbol,side,qty,pnl\nAAPL,BUY,10,70');
  IntegrationLayer.prototype.matchTradeToStrategy = jest.fn().mockResolvedValue({
    name: 'MA Crossover', entrySignal: 'price_crosses_above_50_SMA', symbols: ['AAPL'],
  });
  IntegrationLayer.prototype.analyzeTradeExecution = jest.fn().mockResolvedValue({
    executionScore: 9, slippage: 0.01, exitReason: 'target_hit', timing: 'fast',
  });
  IntegrationLayer.prototype.getStrategy = jest.fn().mockResolvedValue({
    name: 'MA Crossover', params: { fastPeriod: 20, slowPeriod: 50 }, lastBacktest: null,
  });

  AuditLog.prototype.log = jest.fn().mockResolvedValue(undefined);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Chatbot ↔ NLP ↔ Session Integration', () => {
  let chatbot;

  beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
    chatbot = new VAChatbot({ accountSize: 100000, maxRiskPerTrade: 0.02 });
  });

  describe('Full Message Pipeline', () => {
    test('processes should_buy intent end-to-end', async () => {
      const response = await chatbot.processMessage('Should I buy AAPL?', 'session-1');

      expect(response.meta.intent).toBe('should_buy');
      expect(response.data.symbol).toBe('AAPL');
      expect(IntegrationLayer.prototype.runMicroBacktest).toHaveBeenCalledWith('AAPL');
      expect(IntegrationLayer.prototype.getOptimizerRating).toHaveBeenCalledWith('AAPL');
      expect(IntegrationLayer.prototype.getScannerSignal).toHaveBeenCalledWith('AAPL');
      expect(AuditLog.prototype.log).toHaveBeenCalled();
    });

    test('processes best_stock_today intent end-to-end', async () => {
      const response = await chatbot.processMessage("What's the best stock to trade today?", 'session-2');

      expect(response.meta.intent).toBe('best_stock_today');
      expect(IntegrationLayer.prototype.runFullMarketScan).toHaveBeenCalled();
      expect(IntegrationLayer.prototype.rankOpportunitiesWithOptimizer).toHaveBeenCalled();
      expect(Array.isArray(response.data.opportunities)).toBe(true);
    });

    test('processes performance_query intent end-to-end', async () => {
      const response = await chatbot.processMessage('How did yesterday go?', 'session-3');

      expect(response.meta.intent).toBe('performance_query');
      expect(IntegrationLayer.prototype.getAnalytics).toHaveBeenCalledWith('yesterday');
      expect(response.data.totalPnl).toBe(2340.75);
    });

    test('processes custom_backtest intent end-to-end', async () => {
      const response = await chatbot.processMessage(
        'Test this strategy: buy at 50-day MA, sell at 20-day MA',
        'session-4'
      );

      expect(response.meta.intent).toBe('custom_backtest');
      expect(IntegrationLayer.prototype.runFullBacktest).toHaveBeenCalled();
      expect(response.data.grade).toBeDefined();
      expect(response.data.tweaks).toBeDefined();
    });

    test('processes trade_history intent end-to-end', async () => {
      const response = await chatbot.processMessage(
        'Show me all AAPL trades from last week',
        'session-5'
      );

      expect(response.meta.intent).toBe('trade_history');
      expect(IntegrationLayer.prototype.queryTradeHistory).toHaveBeenCalled();
      expect(response.data.trades.length).toBeGreaterThan(0);
    });

    test('processes risk_report intent end-to-end', async () => {
      const response = await chatbot.processMessage('Give me my daily risk report', 'session-6');

      expect(response.meta.intent).toBe('risk_report');
      expect(IntegrationLayer.prototype.generateDailyRiskReport).toHaveBeenCalled();
      expect(response.data.openPositions).toBe(3);
    });

    test('processes export_data intent end-to-end', async () => {
      const response = await chatbot.processMessage('Export trades to csv', 'session-7');

      expect(response.meta.intent).toBe('export_data');
      expect(IntegrationLayer.prototype.exportToCSV).toHaveBeenCalled();
    });
  });

  describe('Session Context Propagation', () => {
    test('carries symbol context between turns', async () => {
      await chatbot.processMessage('Should I buy AAPL?', 'ctx-session');
      const session = chatbot.sessions.getOrCreate('ctx-session');
      expect(session.context.lastSymbol).toBe('AAPL');
    });

    test('carries period context between turns', async () => {
      await chatbot.processMessage('How did I do last week?', 'ctx-session-2');
      const session = chatbot.sessions.getOrCreate('ctx-session-2');
      expect(session.context.lastPeriod).toBe('last week');
    });

    test('maintains multiple sessions independently', async () => {
      await chatbot.processMessage('Should I buy AAPL?', 'user-a');
      await chatbot.processMessage('Should I buy TSLA?', 'user-b');

      const sessionA = chatbot.sessions.getOrCreate('user-a');
      const sessionB = chatbot.sessions.getOrCreate('user-b');

      expect(sessionA.context.lastSymbol).toBe('AAPL');
      expect(sessionB.context.lastSymbol).toBe('TSLA');
    });
  });

  describe('NLP ↔ Chatbot Integration', () => {
    test('NLPEngine correctly routes should_buy to handler', async () => {
      const nlp = new NLPEngine();
      const intent = nlp.parseIntent('Should I buy MSFT?');
      expect(intent.type).toBe('should_buy');
      expect(intent.entities.symbol).toBe('MSFT');
    });

    test('NLPEngine correctly parses strategy for backtest', async () => {
      const nlp = new NLPEngine();
      const strategy = nlp.parseStrategyFromText('Buy at 50-day MA, sell at 20-day SMA, stop loss 2%');
      expect(strategy.entryPeriod).toBe(50);
      expect(strategy.exitPeriod).toBe(20);
      expect(strategy.stopLossPercent).toBeCloseTo(0.02);
    });
  });

  describe('Audit Log Integration', () => {
    test('logs every user query', async () => {
      await chatbot.processMessage('Should I buy AAPL?', 'audit-session');
      expect(AuditLog.prototype.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user_query' })
      );
    });

    test('logs bot responses', async () => {
      await chatbot.processMessage('Should I buy AAPL?', 'audit-session-2');
      expect(AuditLog.prototype.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'bot_response' })
      );
    });

    test('logs buy recommendations', async () => {
      await chatbot.processMessage('Should I buy AAPL?', 'audit-session-3');
      expect(AuditLog.prototype.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'buy_recommendation', symbol: 'AAPL' })
      );
    });
  });

  describe('Error Recovery', () => {
    test('handles integration layer errors gracefully', async () => {
      IntegrationLayer.prototype.runMicroBacktest.mockRejectedValue(new Error('Data unavailable'));
      const response = await chatbot.processMessage('Should I buy AAPL?', 'error-session');
      expect(response.meta.intent).toBe('error');
      expect(response.text).toMatch(/error|try again/i);
    });

    test('handles unknown intent gracefully', async () => {
      const response = await chatbot.processMessage('fnord xyzzy plugh', 'unknown-session');
      expect(response.meta.intent).not.toBe('error');
      expect(response.text.length).toBeGreaterThan(0);
    });
  });
});
