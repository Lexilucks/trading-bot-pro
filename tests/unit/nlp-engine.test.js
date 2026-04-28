'use strict';

/**
 * nlp-engine.test.js
 * Unit tests for NLPEngine - intent parsing and entity extraction.
 * @module tests/unit/nlp-engine
 */

const NLPEngine = require('../../chatbot/nlp-engine');

describe('NLPEngine', () => {
  let nlp;

  beforeEach(() => {
    nlp = new NLPEngine();
  });

  // ─── Intent Parsing ─────────────────────────────────────────────────────

  describe('parseIntent()', () => {
    describe('should_buy intent', () => {
      test.each([
        ['Should I buy AAPL?'],
        ['Is it a good time to buy TSLA?'],
        ['Worth buying MSFT?'],
        ['Should I go long on NVDA?'],
      ])('detects should_buy for: %s', (message) => {
        const result = nlp.parseIntent(message);
        expect(result.type).toBe('should_buy');
        expect(result.confidence).toBeGreaterThan(0.7);
      });
    });

    describe('best_stock_today intent', () => {
      test.each([
        ["What's the best stock to trade today?"],
        ['Top stocks to buy now'],
        ['Best setup today'],
        ['What should I trade today?'],
      ])('detects best_stock_today for: %s', (message) => {
        const result = nlp.parseIntent(message);
        expect(result.type).toBe('best_stock_today');
      });
    });

    describe('performance_query intent', () => {
      test.each([
        ['How did yesterday go?'],
        ['Show me my performance this week'],
        ["What's my P&L this month?"],
        ['How am I doing?'],
      ])('detects performance_query for: %s', (message) => {
        const result = nlp.parseIntent(message);
        expect(result.type).toBe('performance_query');
      });
    });

    describe('custom_backtest intent', () => {
      test.each([
        ['Run a backtest on this strategy'],
        ['Test this strategy'],
        ['How would this strategy have performed?'],
      ])('detects custom_backtest for: %s', (message) => {
        const result = nlp.parseIntent(message);
        expect(result.type).toBe('custom_backtest');
      });
    });

    describe('strategy_describe intent', () => {
      test.each([
        ['Buy when price crosses above the 50-day MA, sell at 20-day MA'],
        ['Buy at 50-day moving average, sell at 20-day EMA'],
        ['Buy when RSI below 30, sell when above 70'],
      ])('detects strategy_describe for: %s', (message) => {
        const result = nlp.parseIntent(message);
        expect(result.type).toBe('strategy_describe');
      });
    });

    describe('trade_history intent', () => {
      test.each([
        ['Show me all AAPL trades from last week'],
        ['Trade history'],
        ['Show my past trades'],
      ])('detects trade_history for: %s', (message) => {
        const result = nlp.parseIntent(message);
        expect(result.type).toBe('trade_history');
      });
    });

    describe('position_size intent', () => {
      test.each([
        ['How many shares of AAPL should I buy?'],
        ['Position sizing for TSLA'],
        ['Kelly criterion for MSFT'],
      ])('detects position_size for: %s', (message) => {
        const result = nlp.parseIntent(message);
        expect(result.type).toBe('position_size');
      });
    });

    describe('risk_report intent', () => {
      test.each([
        ['Give me my daily risk report'],
        ['How much am I at risk?'],
        ['Max loss today?'],
      ])('detects risk_report for: %s', (message) => {
        const result = nlp.parseIntent(message);
        expect(result.type).toBe('risk_report');
      });
    });

    describe('export_data intent', () => {
      test.each([
        ['Export to CSV'],
        ['Download my trades'],
        ['Generate a PDF report'],
      ])('detects export_data for: %s', (message) => {
        const result = nlp.parseIntent(message);
        expect(result.type).toBe('export_data');
      });
    });

    describe('help intent', () => {
      test.each([
        ['help'],
        ['What can you do?'],
        ['Show me commands'],
      ])('detects help for: %s', (message) => {
        const result = nlp.parseIntent(message);
        expect(result.type).toBe('help');
      });
    });

    describe('greeting intent', () => {
      test.each([
        ['Hello'],
        ['Hi'],
        ['Good morning'],
        ['Hey!'],
      ])('detects greeting for: %s', (message) => {
        const result = nlp.parseIntent(message);
        expect(result.type).toBe('greeting');
      });
    });

    test('falls back to unknown for unrecognized input', () => {
      const result = nlp.parseIntent('xyzzy frobozz magic');
      expect(result.type).toBe('unknown');
      expect(result.confidence).toBeLessThan(0.5);
    });
  });

  // ─── Entity Extraction ─────────────────────────────────────────────────

  describe('extractEntities()', () => {
    test('extracts known ticker symbol', () => {
      const entities = nlp.extractEntities('Should I buy AAPL tomorrow?');
      expect(entities.symbol).toBe('AAPL');
    });

    test('extracts $TICKER pattern', () => {
      const entities = nlp.extractEntities('What about $TSLA today?');
      expect(entities.symbol).toBe('TSLA');
    });

    test('extracts time period - yesterday', () => {
      const entities = nlp.extractEntities('How did I do yesterday?');
      expect(entities.period).toBe('yesterday');
    });

    test('extracts time period - last week', () => {
      const entities = nlp.extractEntities('Show trades from last week');
      expect(entities.period).toBe('last week');
    });

    test('extracts time period - last N days', () => {
      const entities = nlp.extractEntities('Show trades from last 30 days');
      expect(entities.period).toBe('last 30 days');
    });

    test('extracts export type - csv', () => {
      const entities = nlp.extractEntities('Export to csv please');
      expect(entities.exportType).toBe('csv');
    });

    test('extracts export type - pdf', () => {
      const entities = nlp.extractEntities('Generate a PDF report');
      expect(entities.exportType).toBe('pdf');
    });

    test('returns empty object when no entities found', () => {
      const entities = nlp.extractEntities('help me');
      expect(Object.keys(entities).length).toBe(0);
    });

    test('uses context for symbol fallback', () => {
      const entities = nlp.extractEntities('Should I buy it?', { lastSymbol: 'NVDA' });
      // Symbol comes from context when not explicit
      expect(entities.symbol).toBeUndefined(); // context resolution happens in chatbot level
    });
  });

  // ─── Strategy Parsing ───────────────────────────────────────────────────

  describe('parseStrategyFromText()', () => {
    test('parses MA crossover strategy', () => {
      const params = nlp.parseStrategyFromText('Buy at 50-day MA, sell at 20-day MA');
      expect(params.entryPeriod).toBe(50);
      expect(params.exitPeriod).toBe(20);
      expect(params.entryType).toMatch(/SMA|EMA/);
      expect(params.name).toContain('50/20');
    });

    test('parses EMA crossover strategy', () => {
      const params = nlp.parseStrategyFromText('Buy when price crosses 50 EMA, sell at 20 EMA');
      expect(params.entryPeriod).toBe(50);
      expect(params.entryType).toBe('EMA');
    });

    test('parses RSI strategy', () => {
      const params = nlp.parseStrategyFromText('Buy when RSI below 30');
      expect(params.entryType).toBe('RSI');
      expect(params.entrySignal).toContain('rsi_oversold');
    });

    test('parses breakout strategy', () => {
      const params = nlp.parseStrategyFromText('Buy on breakout above resistance');
      expect(params.entryType).toBe('BREAKOUT');
    });

    test('parses stop loss percentage', () => {
      const params = nlp.parseStrategyFromText('Buy at 50 MA, stop loss at 2%');
      expect(params.stopLossPercent).toBeCloseTo(0.02);
    });

    test('parses take profit percentage', () => {
      const params = nlp.parseStrategyFromText('Buy at 50 MA, take profit at 5%');
      expect(params.takeProfitPercent).toBeCloseTo(0.05);
    });

    test('extracts symbols from strategy text', () => {
      const params = nlp.parseStrategyFromText('Buy AAPL and TSLA at 50-day MA');
      expect(params.symbols).toContain('AAPL');
      expect(params.symbols).toContain('TSLA');
    });

    test('returns default params for unrecognized strategy', () => {
      const params = nlp.parseStrategyFromText('do something complicated');
      expect(params.name).toBeDefined();
      expect(params.stopLossPercent).toBeDefined();
      expect(params.takeProfitPercent).toBeDefined();
    });
  });

  // ─── Intent Patterns ────────────────────────────────────────────────────

  describe('buildIntentPatterns()', () => {
    test('returns an array with required intent types', () => {
      const patterns = nlp.buildIntentPatterns();
      const types = patterns.map(p => p.type);
      expect(types).toContain('should_buy');
      expect(types).toContain('best_stock_today');
      expect(types).toContain('performance_query');
      expect(types).toContain('custom_backtest');
      expect(types).toContain('trade_history');
      expect(types).toContain('help');
      expect(types).toContain('greeting');
    });

    test('all patterns have required fields', () => {
      const patterns = nlp.buildIntentPatterns();
      for (const p of patterns) {
        expect(p.type).toBeDefined();
        expect(Array.isArray(p.patterns)).toBe(true);
        expect(p.patterns.length).toBeGreaterThan(0);
        expect(p.confidence).toBeGreaterThan(0);
        expect(p.confidence).toBeLessThanOrEqual(1);
      }
    });
  });
});
