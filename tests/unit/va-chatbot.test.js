'use strict';

/**
 * va-chatbot.test.js
 * Unit tests for VAChatbot - the unified chatbot control center.
 * @module tests/unit/va-chatbot
 */

jest.mock('../../chatbot/integration-layer');
jest.mock('../../utils/audit-log');

const VAChatbot = require('../../chatbot/va-chatbot');
const IntegrationLayer = require('../../chatbot/integration-layer');
const AuditLog = require('../../utils/audit-log');

const mockBacktestResult = {
  winRate: 0.6, profitFactor: 1.8, sharpeRatio: 1.2,
  maxDrawdown: 0.12, totalTrades: 150, avgWin: 200, avgLoss: 100,
  equityCurve: [],
};

const mockOptimizerRating = { grade: 'B', score: 0.72 };
const mockScannerSignal = { pattern: 'BREAKOUT', strength: 0.8, volumeRatio: 2.1 };

beforeEach(() => {
  IntegrationLayer.mockClear();
  AuditLog.mockClear();

  IntegrationLayer.prototype.runMicroBacktest = jest.fn().mockResolvedValue(mockBacktestResult);
  IntegrationLayer.prototype.getOptimizerRating = jest.fn().mockResolvedValue(mockOptimizerRating);
  IntegrationLayer.prototype.getScannerSignal = jest.fn().mockResolvedValue(mockScannerSignal);
  IntegrationLayer.prototype.calculateKellyPositionSize = jest.fn().mockReturnValue({
    halfKelly: 10, fullKelly: 20, dollarAmount: 1850, halfKellyFraction: 0.02,
  });
  IntegrationLayer.prototype.runFullMarketScan = jest.fn().mockResolvedValue([
    { symbol: 'AAPL', pattern: 'BREAKOUT', strength: 0.9, volumeRatio: 2.5 },
    { symbol: 'TSLA', pattern: 'MOMENTUM', strength: 0.75, volumeRatio: 1.8 },
  ]);
  IntegrationLayer.prototype.rankOpportunitiesWithOptimizer = jest.fn().mockResolvedValue([
    { symbol: 'AAPL', pattern: 'BREAKOUT', confidence: 0.85, riskReward: 2.5,
      entryPrice: 185, targetPrice: 195, stopPrice: 180 },
  ]);
  IntegrationLayer.prototype.getAnalytics = jest.fn().mockResolvedValue({
    totalPnl: 1250.50, winRate: 0.62, totalTrades: 45,
    maxDrawdown: 0.08, sharpeRatio: 1.4, bestTrade: 320, worstTrade: -180,
  });
  IntegrationLayer.prototype.runFullBacktest = jest.fn().mockResolvedValue(mockBacktestResult);
  IntegrationLayer.prototype.runPaperTradingSimulation = jest.fn().mockResolvedValue({ pnlChart: [] });
  IntegrationLayer.prototype.optimizeStrategy = jest.fn().mockResolvedValue({
    params: { fastPeriod: 22, slowPeriod: 55 }, improvementPercent: 0.15,
    winRate: 0.65, sharpeRatio: 1.4, comparisonChart: null,
  });
  IntegrationLayer.prototype.queryTradeHistory = jest.fn().mockResolvedValue([
    { symbol: 'AAPL', side: 'BUY', qty: 10, entryPrice: 185, exitPrice: 190, pnl: 50, status: 'closed' },
  ]);
  IntegrationLayer.prototype.tradesToCSV = jest.fn().mockReturnValue('header\nrow1');
  IntegrationLayer.prototype.generateDailyRiskReport = jest.fn().mockResolvedValue({
    openPositions: 2, capitalAtRisk: 3000, capitalAtRiskPct: 0.03,
    maxPossibleLoss: 1500, dailyLossLimit: 10000, breaches: [],
  });
  IntegrationLayer.prototype.exportToCSV = jest.fn().mockResolvedValue('csv data');
  IntegrationLayer.prototype.matchTradeToStrategy = jest.fn().mockResolvedValue(null);
  IntegrationLayer.prototype.analyzeTradeExecution = jest.fn().mockResolvedValue({
    executionScore: 8, slippage: 0.02, exitReason: 'target_hit',
  });

  AuditLog.prototype.log = jest.fn().mockResolvedValue(undefined);
});

describe('VAChatbot', () => {
  let chatbot;

  beforeEach(() => {
    chatbot = new VAChatbot({ accountSize: 100000, maxRiskPerTrade: 0.02 });
  });

  // ─── processMessage ────────────────────────────────────────────────────

  describe('processMessage()', () => {
    test('returns a structured response with meta', async () => {
      const response = await chatbot.processMessage('Should I buy AAPL?');
      expect(response).toHaveProperty('text');
      expect(response).toHaveProperty('meta');
      expect(response.meta).toHaveProperty('intent');
      expect(response.meta).toHaveProperty('latencyMs');
      expect(response.meta).toHaveProperty('sessionId');
      expect(response.meta).toHaveProperty('timestamp');
    });

    test('response latency is under 500ms with mocked modules', async () => {
      const response = await chatbot.processMessage('Should I buy AAPL?');
      expect(response.meta.latencyMs).toBeLessThan(500);
    });

    test('handles errors gracefully', async () => {
      IntegrationLayer.prototype.runMicroBacktest.mockRejectedValue(new Error('API timeout'));
      const response = await chatbot.processMessage('Should I buy AAPL?');
      expect(response.text).toContain('error');
      expect(response.meta.intent).toBe('error');
    });

    test('creates session context correctly', async () => {
      await chatbot.processMessage('Should I buy AAPL?', 'test-session');
      await chatbot.processMessage('how about its performance?', 'test-session');
      const session = chatbot.sessions.getOrCreate('test-session');
      expect(session.turns.length).toBe(4); // 2 user + 2 assistant
    });
  });

  // ─── handleShouldBuy ──────────────────────────────────────────────────

  describe('handleShouldBuy', () => {
    test('returns buy recommendation with AAPL', async () => {
      const response = await chatbot.processMessage('Should I buy AAPL?');
      expect(response.text).toContain('AAPL');
      expect(response.data.symbol).toBe('AAPL');
      expect(response.data).toHaveProperty('signal');
      expect(['BUY', 'WATCH', 'AVOID']).toContain(response.data.signal);
    });

    test('asks for symbol when none provided', async () => {
      const response = await chatbot.processMessage('Should I buy it?');
      expect(response.text.toLowerCase()).toMatch(/which stock|ticker|symbol/i);
    });

    test('includes position size in response data', async () => {
      const response = await chatbot.processMessage('Should I buy AAPL?');
      expect(response.data.positionSize).toBeDefined();
      expect(response.data.positionSize.halfKelly).toBeDefined();
    });
  });

  // ─── handleBestStockToday ─────────────────────────────────────────────

  describe('handleBestStockToday', () => {
    test('returns top opportunities', async () => {
      const response = await chatbot.processMessage("What's the best stock to trade today?");
      expect(response.data.opportunities).toBeDefined();
      expect(Array.isArray(response.data.opportunities)).toBe(true);
    });

    test('response text contains stock name', async () => {
      const response = await chatbot.processMessage("What's the best stock to trade today?");
      expect(response.text).toContain('AAPL');
    });
  });

  // ─── handlePerformanceQuery ───────────────────────────────────────────

  describe('handlePerformanceQuery', () => {
    test('returns analytics data', async () => {
      const response = await chatbot.processMessage('How did yesterday go?');
      expect(response.data).toHaveProperty('totalPnl');
      expect(response.data).toHaveProperty('winRate');
      expect(response.data).toHaveProperty('totalTrades');
    });

    test('response text contains P&L', async () => {
      const response = await chatbot.processMessage('How did yesterday go?');
      expect(response.text).toContain('P&L');
      expect(response.text).toContain('1250.50');
    });
  });

  // ─── handleCustomBacktest ─────────────────────────────────────────────

  describe('handleCustomBacktest', () => {
    test('runs backtest and returns grade', async () => {
      const response = await chatbot.processMessage(
        'Test this strategy: buy at 50-day MA, sell at 20-day MA'
      );
      expect(response.data).toHaveProperty('grade');
      expect(response.data).toHaveProperty('backtest');
      expect('ABCDF').toContain(response.data.grade[0]);
    });
  });

  // ─── gradeStrategy ────────────────────────────────────────────────────

  describe('gradeStrategy()', () => {
    test('grades excellent strategy as A', () => {
      const grade = chatbot.gradeStrategy({
        winRate: 0.60, profitFactor: 2.5, sharpeRatio: 2.0,
        maxDrawdown: 0.05, totalTrades: 200,
      });
      expect(['A', 'A+']).toContain(grade);
    });

    test('grades poor strategy as D or F', () => {
      const grade = chatbot.gradeStrategy({
        winRate: 0.35, profitFactor: 0.8, sharpeRatio: 0.3,
        maxDrawdown: 0.45, totalTrades: 10,
      });
      expect(['D', 'F']).toContain(grade);
    });

    test('grades average strategy as C or B', () => {
      const grade = chatbot.gradeStrategy({
        winRate: 0.50, profitFactor: 1.3, sharpeRatio: 0.9,
        maxDrawdown: 0.18, totalTrades: 80,
      });
      expect(['C', 'B']).toContain(grade);
    });
  });

  // ─── suggestStrategyTweaks ────────────────────────────────────────────

  describe('suggestStrategyTweaks()', () => {
    test('suggests stop loss tightening for high drawdown', () => {
      const tweaks = chatbot.suggestStrategyTweaks(
        { winRate: 0.5, maxDrawdown: 0.35, profitFactor: 1.0, sharpeRatio: 0.8, totalTrades: 50 },
        {}
      );
      expect(tweaks.some(t => t.toLowerCase().includes('stop'))).toBe(true);
    });

    test('returns positive message for solid strategy', () => {
      const tweaks = chatbot.suggestStrategyTweaks(
        { winRate: 0.6, maxDrawdown: 0.08, profitFactor: 2.0, sharpeRatio: 1.5, totalTrades: 200 },
        {}
      );
      expect(tweaks.length).toBeGreaterThan(0);
    });
  });

  // ─── checkRiskConstraints ────────────────────────────────────────────

  describe('checkRiskConstraints()', () => {
    test('returns null when position is within limits', () => {
      const violation = chatbot.checkRiskConstraints({ dollarAmount: 1500 });
      expect(violation).toBeNull();
    });

    test('returns warning when position exceeds max risk', () => {
      const violation = chatbot.checkRiskConstraints({ dollarAmount: 5000 }); // 5% of 100k > 2%
      expect(violation).not.toBeNull();
      expect(typeof violation).toBe('string');
    });
  });

  // ─── analyzeClosedTrade ───────────────────────────────────────────────

  describe('analyzeClosedTrade()', () => {
    test('returns trade analysis with coaching', async () => {
      const trade = {
        symbol: 'AAPL', side: 'BUY', qty: 10,
        entryPrice: 185, exitPrice: 190, pnl: 50, executionMs: 45,
      };
      const result = await chatbot.analyzeClosedTrade(trade);
      expect(result).toHaveProperty('trade');
      expect(result).toHaveProperty('coaching');
      expect(result.coaching).toContain('AAPL');
    });
  });

  // ─── handleHelp ──────────────────────────────────────────────────────

  describe('handleHelp()', () => {
    test('returns help text with examples', async () => {
      const response = await chatbot.processMessage('help');
      expect(response.text.length).toBeGreaterThan(100);
      expect(response.text).toContain('Should I buy');
    });
  });

  // ─── handleGreeting ───────────────────────────────────────────────────

  describe('handleGreeting()', () => {
    test('returns greeting response', async () => {
      const response = await chatbot.processMessage('Hello');
      expect(response.text.toLowerCase()).toMatch(/good\s+(morning|afternoon|evening)|hello|hi/i);
    });
  });
});
