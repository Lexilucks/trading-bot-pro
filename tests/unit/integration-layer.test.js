'use strict';

const IntegrationLayer = require('../../chatbot/integration-layer');

describe('IntegrationLayer', () => {
  test('exports required async bridge functions', () => {
    expect(typeof IntegrationLayer.callPaperTrading).toBe('function');
    expect(typeof IntegrationLayer.callBacktest).toBe('function');
    expect(typeof IntegrationLayer.callScanner).toBe('function');
    expect(typeof IntegrationLayer.callOptimizer).toBe('function');
  });

  test('callPaperTrading returns a result object', async () => {
    const result = await IntegrationLayer.callPaperTrading({
      symbol: 'AAPL',
      buyTarget: 185,
      sellTarget: 195,
      positionSize: 10,
      stopLoss: 178,
    });

    expect(result).toHaveProperty('success');
    expect(result.data.symbol).toBe('AAPL');
    expect(result.data).toHaveProperty('winRate');
    expect(result.data).toHaveProperty('totalPnL');
  });

  test('callScanner returns all scanner rows', async () => {
    const result = await IntegrationLayer.callScanner();
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeGreaterThanOrEqual(6);
    expect(result.data[0]).toHaveProperty('symbol');
    expect(result.data[0]).toHaveProperty('momentum');
    expect(result.data[0]).toHaveProperty('signal');
  });

  test('class adapter supports chatbot methods', async () => {
    const layer = new IntegrationLayer({ dbPath: ':memory:' });
    const backtest = await layer.runMicroBacktest('MSFT');
    const scannerSignal = await layer.getScannerSignal('MSFT');
    const position = layer.calculateKellyPositionSize({ winRate: 0.62, avgWin: 200, avgLoss: -120, accountSize: 100000 });

    expect(backtest.symbol).toBe('MSFT');
    expect(scannerSignal.symbol).toBe('MSFT');
    expect(position.halfKelly).toBeGreaterThanOrEqual(1);
    layer.db.close();
  });
});
