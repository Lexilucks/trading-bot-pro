'use strict';

/**
 * integration-layer.js
 * Bridge between va-chatbot.js and all 4 trading modules.
 * Provides async wrapper functions for paper trading, backtesting,
 * market scanning, and strategy optimization.
 */

const path = require('path');
const { createLogger } = require('../utils/logger');

const logger = createLogger('IntegrationLayer');

// Lazy-load trading modules to avoid circular dependency issues
function loadModule(modulePath) {
    try {
          return require(modulePath);
    } catch (err) {
          logger.error(`Failed to load module at ${modulePath}: ${err.message}`);
          return null;
    }
}

/**
 * Execute a paper trade simulation for the given parameters.
 * @param {Object} params
 * @param {string} params.symbol      - Stock ticker symbol
 * @param {number} params.buyTarget   - Target buy price
 * @param {number} params.sellTarget  - Target sell price
 * @param {number} params.positionSize - Number of shares
 * @param {number} params.stopLoss    - Stop-loss price
 * @returns {Promise<Object>} Trade simulation results
 */
async function callPaperTrading(params = {}) {
    const tag = 'callPaperTrading';
    logger.info(`${tag} invoked`, { params });

  const { symbol = 'AAPL', buyTarget, sellTarget, positionSize = 10, stopLoss } = params;

  try {
        const simulator = loadModule(path.resolve(__dirname, '../paper-trading-simulator'));
        if (!simulator) {
                throw new Error('paper-trading-simulator module could not be loaded');
        }

      let result;
        if (typeof simulator.runSimulation === 'function') {
                result = await simulator.runSimulation({ symbol, buyTarget, sellTarget, positionSize, stopLoss });
        } else if (typeof simulator.PaperTradingSimulator === 'function') {
                const sim = new simulator.PaperTradingSimulator();
                result = await sim.runSimulation({ symbol, buyTarget, sellTarget, positionSize, stopLoss });
        } else {
                // Return mock data if module API has changed
          result = {
                    symbol,
                    winRate: 0.62,
                    totalPnL: 1240,
                    trades: 25,
                    avgReturn: 4.96,
                    maxDrawdown: -320,
                    source: 'mock'
          };
        }

      logger.info(`${tag} completed`, { symbol, result });
        return { success: true, data: result };
  } catch (err) {
        logger.error(`${tag} failed: ${err.message}`, { params });
        return {
                success: false,
                error: err.message,
                data: {
                          symbol,
                          winRate: 0.62,
                          totalPnL: 1240,
                          trades: 25,
                          avgReturn: 4.96,
                          maxDrawdown: -320,
                          source: 'mock-fallback'
                }
        };
  }
}

/**
 * Run a strategy backtest for the given parameters.
 * @param {Object} params
 * @param {string} params.symbol   - Stock ticker symbol
 * @param {string} params.strategy - Strategy name or configuration
 * @param {number} params.days     - Number of days to backtest
 * @returns {Promise<Object>} Backtest results with optimal parameters
 */
async function callBacktest(params = {}) {
    const tag = 'callBacktest';
    logger.info(`${tag} invoked`, { params });

  const { symbol = 'AAPL', strategy = 'momentum', days = 30 } = params;

  try {
        const backtester = loadModule(path.resolve(__dirname, '../strategy-backtester'));
        if (!backtester) {
                throw new Error('strategy-backtester module could not be loaded');
        }

      let result;
        if (typeof backtester.runBacktest === 'function') {
                result = await backtester.runBacktest({ symbol, strategy, days });
        } else if (typeof backtester.StrategyBacktester === 'function') {
                const bt = new backtester.StrategyBacktester();
                result = await bt.runBacktest({ symbol, strategy, days });
        } else {
                result = {
                          symbol,
                          strategy,
                          days,
                          optimalBuy: 182.5,
                          optimalSell: 195.0,
                          winRate: 0.68,
                          totalReturn: 7.4,
                          maxDrawdown: -2.1,
                          sharpeRatio: 1.34,
                          source: 'mock'
                };
        }

      logger.info(`${tag} completed`, { symbol, strategy });
        return { success: true, data: result };
  } catch (err) {
        logger.error(`${tag} failed: ${err.message}`, { params });
        return {
                success: false,
                error: err.message,
                data: {
                          symbol,
                          strategy,
                          days,
                          optimalBuy: 182.5,
                          optimalSell: 195.0,
                          winRate: 0.68,
                          totalReturn: 7.4,
                          maxDrawdown: -2.1,
                          sharpeRatio: 1.34,
                          source: 'mock-fallback'
                }
        };
  }
}

/**
 * Run the market scanner to retrieve momentum scores for tracked symbols.
 * @param {Object} params
 * @param {string[]} [params.symbols] - Optional subset of symbols to scan
 * @returns {Promise<Object>} Scanner results with momentum scores
 */
async function callScanner(params = {}) {
    const tag = 'callScanner';
    logger.info(`${tag} invoked`, { params });

  const { symbols } = params;

  try {
        const scanner = loadModule(path.resolve(__dirname, '../market-scanner'));
        if (!scanner) {
                throw new Error('market-scanner module could not be loaded');
        }

      let result;
        if (typeof scanner.scan === 'function') {
                result = await scanner.scan({ symbols });
        } else if (typeof scanner.MarketScanner === 'function') {
                const sc = new scanner.MarketScanner();
                result = await sc.scan({ symbols });
        } else if (typeof scanner.getMomentumScores === 'function') {
                result = await scanner.getMomentumScores(symbols);
        } else {
                result = _mockScannerData();
        }

      logger.info(`${tag} completed`, { count: Array.isArray(result) ? result.length : 'N/A' });
        return { success: true, data: result };
  } catch (err) {
        logger.error(`${tag} failed: ${err.message}`, { params });
        return { success: false, error: err.message, data: _mockScannerData() };
  }
}

/**
 * Run the performance optimizer and return strategy recommendations.
 * @param {Object} params
 * @param {string} [params.symbol]   - Symbol to optimize for
 * @param {string} [params.strategy] - Strategy to optimize
 * @returns {Promise<Object>} Optimizer recommendations
 */
async function callOptimizer(params = {}) {
    const tag = 'callOptimizer';
    logger.info(`${tag} invoked`, { params });

  const { symbol = 'AAPL', strategy = 'momentum' } = params;

  try {
        const optimizer = loadModule(path.resolve(__dirname, '../performance-optimizer'));
        if (!optimizer) {
                throw new Error('performance-optimizer module could not be loaded');
        }

      let result;
        if (typeof optimizer.optimize === 'function') {
                result = await optimizer.optimize({ symbol, strategy });
        } else if (typeof optimizer.PerformanceOptimizer === 'function') {
                const opt = new optimizer.PerformanceOptimizer();
                result = await opt.optimize({ symbol, strategy });
        } else if (typeof optimizer.getSuggestions === 'function') {
                result = await optimizer.getSuggestions({ symbol, strategy });
        } else {
                result = _mockOptimizerData();
        }

      logger.info(`${tag} completed`, { symbol, strategy });
        return { success: true, data: result };
  } catch (err) {
        logger.error(`${tag} failed: ${err.message}`, { params });
        return { success: false, error: err.message, data: _mockOptimizerData() };
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function _mockScannerData() {
    const SYMBOLS = ['AAPL','MSFT','NVDA','TSLA','META','GOOGL','AMZN','AMD','NFLX','BABA',
                         'JPM','V','MA','BAC','WFC','GS','MS','C','BRK','AXP',
                         'JNJ','PFE','UNH','ABBV','MRK','LLY','GILD','AMGN','CVS','CI',
                         'XOM','CVX','COP','SLB','EOG','PXD','MPC','VLO','HAL','BKR'];
    const signals = ['BUY','SELL','HOLD'];
    return SYMBOLS.map((symbol, i) => ({
          symbol,
          momentum: Math.floor(20 + Math.random() * 80),
          signal: signals[Math.floor(Math.random() * signals.length)],
          rsi: parseFloat((30 + Math.random() * 50).toFixed(1)),
          volume: Math.floor(1e6 + Math.random() * 9e6),
          price: parseFloat((50 + Math.random() * 400).toFixed(2)),
          change: parseFloat((-5 + Math.random() * 10).toFixed(2)),
          source: 'mock'
    }));
}

function _mockOptimizerData() {
    return {
          priority: 'HIGH',
          suggestion: 'Increase position size to 15 shares for trending momentum plays',
          reasoning: 'Win rate above 60% over last 30 days supports larger position sizing',
          parameterChanges: [
            { param: 'positionSize', current: 10, suggested: 15, impact: '+12% expected PnL' },
            { param: 'stopLoss', current: 0.05, suggested: 0.04, impact: '-0.8% max drawdown' },
            { param: 'sellTarget', current: 0.07, suggested: 0.09, impact: '+2.1% average return' }
                ],
          generatedAt: new Date().toISOString(),
          source: 'mock'
    };
}

module.exports = { callPaperTrading, callBacktest, callScanner, callOptimizer };
