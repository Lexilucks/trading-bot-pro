'use strict';

const request = require('supertest');
const { app } = require('../../server');

const headers = {
  'X-Session-Token': 'test-session',
  'X-CSRF-Token': 'test-csrf-token',
};

describe('Dashboard API', () => {
  test('serves health check', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.success).toBe(true);
  });

  test('blocks POST requests without session token', async () => {
    const res = await request(app).post('/api/paper-trading/run').send({ symbol: 'AAPL' }).expect(401);
    expect(res.body.error).toMatch(/Session token/);
  });

  test('runs paper-trading endpoint with mock-safe response', async () => {
    const res = await request(app)
      .post('/api/paper-trading/run')
      .set(headers)
      .send({ symbol: 'AAPL', buyTarget: 185, sellTarget: 195, positionSize: 10, stopLoss: 178 })
      .expect(200);

    expect(res.body).toHaveProperty('success');
    expect(res.body.data.symbol).toBe('AAPL');
  });

  test('runs custom backtest endpoint', async () => {
    const res = await request(app)
      .post('/api/backtest/custom')
      .set(headers)
      .send({ symbol: 'MSFT', strategy: 'momentum', days: 30 })
      .expect(200);

    expect(res.body.data.symbol).toBe('MSFT');
  });

  test('returns scanner momentum data', async () => {
    const res = await request(app).get('/api/scanner/momentum').expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(6);
  });

  test('returns performance summary', async () => {
    const res = await request(app).get('/api/performance/summary').expect(200);
    expect(res.body.data.summary).toHaveProperty('winRate');
    expect(res.body.data.dailyPnl).toHaveLength(30);
  });

  test('returns optimizer suggestions', async () => {
    const res = await request(app)
      .post('/api/optimizer/suggestions')
      .set(headers)
      .send({ symbol: 'NVDA', metrics: { winRate: 0.62 } })
      .expect(200);

    expect(res.body.data).toHaveProperty('recommendations');
  });
});
