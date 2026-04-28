'use strict';

/**
 * end-to-end.test.js
 * E2E tests: Full query → analysis → recommendation → verification pipeline.
 * Uses supertest to test the HTTP API server with mocked trading modules.
 * @module tests/e2e/end-to-end
 */

jest.mock('../../chatbot/integration-layer');
jest.mock('../../utils/audit-log');

const request = require('supertest');
const { app } = require('../../chatbot/chatbot-server');
const IntegrationLayer = require('../../chatbot/integration-layer');
const AuditLog = require('../../utils/audit-log');

// ─── Mock Setup ─────────────────────────────────────────────────────────────

beforeAll(() => {
  IntegrationLayer.prototype.runMicroBacktest = jest.fn().mockResolvedValue({
    winRate: 0.62, profitFactor: 1.9, sharpeRatio: 1.3, maxDrawdown: 0.11,
    totalTrades: 130, avgWin: 210, avgLoss: 95, equityCurve: [],
  });
  IntegrationLayer.prototype.getOptimizerRating = jest.fn().mockResolvedValue({ grade: 'B+', score: 0.78 });
  IntegrationLayer.prototype.getScannerSignal = jest.fn().mockResolvedValue({ pattern: 'BREAKOUT', strength: 0.82 });
  IntegrationLayer.prototype.calculateKellyPositionSize = jest.fn().mockReturnValue({
    halfKelly: 11, fullKelly: 22, dollarAmount: 2035, halfKellyFraction: 0.020,
  });
  IntegrationLayer.prototype.runFullMarketScan = jest.fn().mockResolvedValue([
    { symbol: 'AAPL', pattern: 'BREAKOUT', strength: 0.90, volumeRatio: 2.5, currentPrice: 185 },
  ]);
  IntegrationLayer.prototype.rankOpportunitiesWithOptimizer = jest.fn().mockResolvedValue([
    { symbol: 'AAPL', confidence: 0.88, riskReward: 2.9, pattern: 'BREAKOUT',
      entryPrice: 185, targetPrice: 196, stopPrice: 179 },
  ]);
  IntegrationLayer.prototype.getAnalytics = jest.fn().mockResolvedValue({
    totalPnl: 1890.25, winRate: 0.65, totalTrades: 48, maxDrawdown: 0.08, sharpeRatio: 1.6,
    bestTrade: 380, worstTrade: -190,
  });
  IntegrationLayer.prototype.runFullBacktest = jest.fn().mockResolvedValue({
    winRate: 0.60, profitFactor: 1.85, sharpeRatio: 1.25, maxDrawdown: 0.13,
    totalTrades: 145, avgWin: 195, avgLoss: 98, equityCurve: [],
  });
  IntegrationLayer.prototype.runPaperTradingSimulation = jest.fn().mockResolvedValue({ pnlChart: null });
  IntegrationLayer.prototype.optimizeStrategy = jest.fn().mockResolvedValue({
    params: { fastPeriod: 21, slowPeriod: 52 }, improvementPercent: 0.10,
    winRate: 0.63, sharpeRatio: 1.3, comparisonChart: null,
  });
  IntegrationLayer.prototype.queryTradeHistory = jest.fn().mockResolvedValue([
    { symbol: 'AAPL', side: 'BUY', qty: 10, entryPrice: 185, exitPrice: 191, pnl: 60, status: 'closed' },
  ]);
  IntegrationLayer.prototype.tradesToCSV = jest.fn().mockReturnValue('symbol,side,qty,pnl\nAAPL,BUY,10,60');
  IntegrationLayer.prototype.generateDailyRiskReport = jest.fn().mockResolvedValue({
    openPositions: 2, capitalAtRisk: 3500, capitalAtRiskPct: 0.035,
    maxPossibleLoss: 1750, dailyLossLimit: 10000, breaches: [],
  });
  IntegrationLayer.prototype.exportToCSV = jest.fn().mockResolvedValue('symbol,side,qty,pnl\nAAPL,BUY,10,60');
  IntegrationLayer.prototype.matchTradeToStrategy = jest.fn().mockResolvedValue(null);
  IntegrationLayer.prototype.analyzeTradeExecution = jest.fn().mockResolvedValue({
    executionScore: 9, slippage: 0.01, exitReason: 'target_hit', timing: 'fast',
  });
  IntegrationLayer.prototype.getStrategy = jest.fn().mockResolvedValue(null);

  AuditLog.prototype.log = jest.fn().mockResolvedValue(undefined);
});

// ─── HTTP API E2E Tests ──────────────────────────────────────────────────────

describe('E2E: HTTP API', () => {
  describe('GET /api/health', () => {
    test('returns 200 with health status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('uptime');
    });
  });

  describe('POST /api/chat', () => {
    test('responds to should_buy query correctly', async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({ message: 'Should I buy AAPL?', sessionId: 'e2e-1' })
        .expect('Content-Type', /json/);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.text).toContain('AAPL');
      expect(res.body.meta.intent).toBe('should_buy');
    });

    test('responds to best_stock_today query', async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({ message: "What's the best stock to trade today?", sessionId: 'e2e-2' });

      expect(res.status).toBe(200);
      expect(res.body.meta.intent).toBe('best_stock_today');
      expect(res.body.data.opportunities).toBeDefined();
    });

    test('responds to performance query', async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({ message: 'How did yesterday go?', sessionId: 'e2e-3' });

      expect(res.status).toBe(200);
      expect(res.body.meta.intent).toBe('performance_query');
    });

    test('responds to strategy backtest query', async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({ message: 'Test this strategy: buy at 50-day MA, sell at 20-day MA', sessionId: 'e2e-4' });

      expect(res.status).toBe(200);
      expect(res.body.meta.intent).toBe('custom_backtest');
      expect(res.body.data.grade).toBeDefined();
    });

    test('validates missing message field', async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({ sessionId: 'e2e-5' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    test('validates message too long', async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({ message: 'x'.repeat(2001), sessionId: 'e2e-6' });

      expect(res.status).toBe(400);
    });

    test('responds within 500ms', async () => {
      const start = Date.now();
      await request(app)
        .post('/api/chat')
        .send({ message: 'Should I buy AAPL?', sessionId: 'e2e-perf' });
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(500);
    });
  });

  describe('POST /api/analyze-trade', () => {
    test('analyzes a closed trade', async () => {
      const res = await request(app)
        .post('/api/analyze-trade')
        .send({
          symbol: 'AAPL', side: 'BUY', qty: 10,
          entryPrice: 185, exitPrice: 191, pnl: 60, executionMs: 45,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.analysis).toHaveProperty('coaching');
    });

    test('validates required trade fields', async () => {
      const res = await request(app)
        .post('/api/analyze-trade')
        .send({ symbol: 'AAPL' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/market-scan', () => {
    test('returns scan results', async () => {
      const res = await request(app).get('/api/market-scan');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/top-picks', () => {
    test('returns today\'s top opportunities', async () => {
      const res = await request(app).get('/api/top-picks');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.opportunities).toBeDefined();
    });
  });

  describe('GET /api/daily-risk-report', () => {
    test('returns daily risk report', async () => {
      const res = await request(app).get('/api/daily-risk-report');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.report.openPositions).toBeDefined();
    });
  });

  describe('POST /api/backtest', () => {
    test('runs strategy backtest', async () => {
      const res = await request(app)
        .post('/api/backtest')
        .send({ strategyDescription: 'buy at 50-day MA, sell at 20-day MA' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('validates missing strategyDescription', async () => {
      const res = await request(app).post('/api/backtest').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/performance', () => {
    test('returns performance data', async () => {
      const res = await request(app).get('/api/performance?period=this+month');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/export/trades', () => {
    test('returns CSV content', async () => {
      const res = await request(app).get('/api/export/trades');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
    });
  });

  describe('GET /api/audit', () => {
    test('returns audit log', async () => {
      const res = await request(app).get('/api/audit');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('404 handling', () => {
    test('returns 404 for unknown routes', async () => {
      const res = await request(app).get('/api/nonexistent');
      expect(res.status).toBe(404);
    });
  });
});

// ─── Full Walk-through E2E ───────────────────────────────────────────────────

describe('E2E: Complete Trade Walk-through', () => {
  const SESSION = 'walkthrough-session';

  test('Step 1: User asks for market scan', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'Scan the market for breakouts', sessionId: SESSION });
    expect(res.status).toBe(200);
    expect(res.body.meta.intent).toBe('market_scan');
  });

  test('Step 2: User asks about a specific stock', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'Should I buy AAPL?', sessionId: SESSION });
    expect(res.status).toBe(200);
    expect(res.body.data.signal).toBeDefined();
  });

  test('Step 3: User asks for position size', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'How many shares of AAPL should I buy?', sessionId: SESSION });
    expect(res.status).toBe(200);
    expect(res.body.meta.intent).toBe('position_size');
  });

  test('Step 4: User requests backtest verification', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'Test this: buy AAPL at 50-day MA, stop loss 2%', sessionId: SESSION });
    expect(res.status).toBe(200);
    expect(res.body.data.backtest).toBeDefined();
  });

  test('Step 5: User checks performance after trades', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'How did I do this week?', sessionId: SESSION });
    expect(res.status).toBe(200);
    expect(res.body.data.totalPnl).toBeDefined();
  });

  test('Step 6: User exports tax report', async () => {
    const res = await request(app).get('/api/export/trades');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('trades.csv');
  });
});
