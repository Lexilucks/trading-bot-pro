// Strategy Backtester
// Tests buy/sell targets, calculates optimal position sizes, shows best/worst scenarios
// Run: node strategy-backtester.js
// Integrates with trading-bot-pro ecosystem on ports 3000/3001

const fs = require('fs');
const path = require('path');

// ─── Configuration ────────────────────────────────────────────────────────────
const CONFIG = {
  CAPITAL: 100000,
  OUTPUT_DIR: './backtest-results',
  SYMBOLS: ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'META', 'GOOGL'],
  COMMISSION_PCT: 0.001,        // 0.1% per trade (round trip = 0.2%)
  SLIPPAGE_PCT:   0.0005,       // 0.05% slippage per fill
};

// ─── Historical Data (reuses paper-trading-simulator GBM generator) ───────────
function generateHistory(symbol, days = 60) {
  const seeds = {
    AAPL: { price: 185, vol: 0.018, drift: 0.0003 },
    MSFT: { price: 415, vol: 0.016, drift: 0.0004 },
    NVDA: { price: 875, vol: 0.028, drift: 0.0006 },
    TSLA: { price: 245, vol: 0.035, drift: 0.0002 },
    META: { price: 505, vol: 0.022, drift: 0.0005 },
    GOOGL:{ price: 175, vol: 0.017, drift: 0.0003 },
  };
  const s = seeds[symbol] || { price: 100, vol: 0.02, drift: 0.0003 };
  const data = [];
  let price = s.price;
  const now = new Date();
  for (let i = days; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    const z = Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());
    price = price * Math.exp((s.drift - 0.5 * s.vol ** 2) + s.vol * z);
    const range = price * (0.005 + Math.random() * 0.012);
    data.push({
      date: date.toISOString().split('T')[0],
      open:  +(price * (1 + (Math.random() - 0.5) * 0.004)).toFixed(2),
      high:  +(price + range).toFixed(2),
      low:   +(price - range).toFixed(2),
      close: +price.toFixed(2),
      volume: Math.floor(5e6 + Math.random() * 20e6),
    });
  }
  return data;
}

// ─── Strategy Definitions ─────────────────────────────────────────────────────
const STRATEGIES = {
  'MA_Crossover': {
    description: 'Fast/Slow SMA crossover',
    params: { fast: [5, 8, 10], slow: [20, 30, 50] },
    generate(history, { fast, slow }) {
      const closes = history.map(d => d.close);
      const fastMA = sma(closes, fast), slowMA = sma(closes, slow);
      return history.map((d, i) => {
        if (!fastMA[i] || !slowMA[i]) return null;
        if (fastMA[i] > slowMA[i] && fastMA[i-1] && fastMA[i-1] <= slowMA[i-1]) return { ...d, signal: 'BUY' };
        if (fastMA[i] < slowMA[i] && fastMA[i-1] && fastMA[i-1] >= slowMA[i-1]) return { ...d, signal: 'SELL' };
        return null;
      }).filter(Boolean);
    },
  },
  'RSI_MeanRevert': {
    description: 'RSI overbought/oversold mean reversion',
    params: { period: [7, 14, 21], oversold: [25, 30, 35], overbought: [65, 70, 75] },
    generate(history, { period, oversold, overbought }) {
      const closes = history.map(d => d.close);
      const rsiVals = rsi(closes, period);
      return history.map((d, i) => {
        if (!rsiVals[i]) return null;
        if (rsiVals[i] < oversold) return { ...d, signal: 'BUY' };
        if (rsiVals[i] > overbought) return { ...d, signal: 'SELL' };
        return null;
      }).filter(Boolean);
    },
  },
  'Breakout': {
    description: 'N-day price channel breakout',
    params: { lookback: [10, 15, 20] },
    generate(history, { lookback }) {
      return history.map((d, i) => {
        if (i < lookback) return null;
        const window = history.slice(i - lookback, i);
        const highest = Math.max(...window.map(x => x.high));
        const lowest  = Math.min(...window.map(x => x.low));
        if (d.close > highest) return { ...d, signal: 'BUY' };
        if (d.close < lowest)  return { ...d, signal: 'SELL' };
        return null;
      }).filter(Boolean);
    },
  },
  'VWAP_Deviation': {
    description: 'Buy below VWAP, sell above VWAP by threshold',
    params: { threshold: [0.01, 0.015, 0.02] },
    generate(history, { threshold }) {
      const closes  = history.map(d => d.close);
      const volumes = history.map(d => d.volume);
      return history.map((d, i) => {
        if (i < 5) return null;
        const slice = history.slice(Math.max(0, i - 20), i + 1);
        const vwap = slice.reduce((s, x) => s + x.close * x.volume, 0) / slice.reduce((s, x) => s + x.volume, 0);
        const deviation = (d.close - vwap) / vwap;
        if (deviation < -threshold) return { ...d, signal: 'BUY', vwap };
        if (deviation >  threshold) return { ...d, signal: 'SELL', vwap };
        return null;
      }).filter(Boolean);
    },
  },
};

// ─── Indicators ───────────────────────────────────────────────────────────────
function sma(prices, period) {
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    return prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  });
}
function rsi(prices, period = 14) {
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  const gains = changes.map(c => c > 0 ? c : 0);
  const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);
  const out = Array(period).fill(null);
  let ag = gains.slice(0, period).reduce((a,b)=>a+b,0)/period;
  let al = losses.slice(0, period).reduce((a,b)=>a+b,0)/period;
  out.push(al===0?100:100-100/(1+ag/al));
  for (let i = period; i < changes.length; i++) {
    ag = (ag*(period-1)+gains[i])/period;
    al = (al*(period-1)+losses[i])/period;
    out.push(al===0?100:100-100/(1+ag/al));
  }
  return out;
}

// ─── Position Sizing Methods ──────────────────────────────────────────────────
const SIZING_METHODS = {
  fixed(capital, price) {
    return Math.floor(capital * 0.1 / price); // 10% of capital per trade
  },
  kelly(capital, price, winRate, avgWinLoss) {
    const k = Math.max(0, Math.min(0.25, winRate - (1 - winRate) / avgWinLoss));
    return Math.floor(capital * k / price);
  },
  volatility(capital, price, atr) {
    const riskPerTrade = capital * 0.01; // 1% risk
    const stopDist = Math.max(atr * 1.5, price * 0.02);
    return Math.floor(riskPerTrade / stopDist);
  },
  equal(capital, price, numSymbols = 6) {
    return Math.floor((capital / numSymbols) / price);
  },
};

// ─── Backtest Engine ──────────────────────────────────────────────────────────
function backtest(history, signals, sizingMethod = 'fixed', params = {}) {
  let cash = CONFIG.CAPITAL;
  let shares = 0, entryPrice = 0, entryDate = null;
  const trades = [], equityCurve = [{ date: history[0].date, equity: cash }];
  let peakEquity = cash, maxDrawdown = 0;

  // Simple ATR calc for volatility sizing
  const atr = history.slice(-20).reduce((s, d) => s + (d.high - d.low), 0) / 20;

  for (const sig of signals) {
    const slipFactor = sig.signal === 'BUY' ? 1 + CONFIG.SLIPPAGE_PCT : 1 - CONFIG.SLIPPAGE_PCT;
    const fillPrice = +(sig.close * slipFactor).toFixed(4);
    const commission = fillPrice * CONFIG.COMMISSION_PCT;

    if (sig.signal === 'BUY' && shares === 0 && cash > fillPrice) {
      // Pick a sizing approach
      let qty;
      if (sizingMethod === 'kelly') {
        const prevTrades = trades.filter(t => t.pnl !== undefined);
        const wins = prevTrades.filter(t => t.pnl > 0);
        const winRate = prevTrades.length ? wins.length / prevTrades.length : 0.5;
        const avgWinLoss = wins.length && (prevTrades.length - wins.length) ?
          (wins.reduce((s,t)=>s+t.pnl,0)/wins.length) /
          Math.abs(prevTrades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0) / (prevTrades.length - wins.length) || 1) : 1.5;
        qty = SIZING_METHODS.kelly(cash, fillPrice, winRate, avgWinLoss);
      } else if (sizingMethod === 'volatility') {
        qty = SIZING_METHODS.volatility(cash, fillPrice, atr);
      } else {
        qty = SIZING_METHODS.fixed(cash, fillPrice);
      }
      qty = Math.max(1, qty);
      const cost = qty * fillPrice + commission * qty;
      if (cost > cash) qty = Math.floor((cash * 0.95) / (fillPrice + commission));
      if (qty < 1) continue;

      shares = qty;
      cash -= qty * fillPrice + commission * qty;
      entryPrice = fillPrice;
      entryDate = sig.date;
      trades.push({ date: sig.date, action: 'BUY', shares: qty, price: fillPrice, cashAfter: +cash.toFixed(2) });

    } else if (sig.signal === 'SELL' && shares > 0) {
      const proceeds = shares * fillPrice - commission * shares;
      const pnl = (fillPrice - entryPrice) * shares - commission * shares * 2;
      cash += proceeds;
      trades.push({
        date: sig.date, action: 'SELL', shares, price: fillPrice,
        entryPrice, pnl: +pnl.toFixed(2), cashAfter: +cash.toFixed(2),
        holdDays: Math.round((new Date(sig.date) - new Date(entryDate)) / 86400000),
        returnPct: +((fillPrice - entryPrice) / entryPrice * 100).toFixed(2),
      });
      shares = 0;
    }

    const equity = cash + shares * sig.close;
    equityCurve.push({ date: sig.date, equity: +equity.toFixed(2) });
    if (equity > peakEquity) peakEquity = equity;
    const dd = (peakEquity - equity) / peakEquity * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Force close
  if (shares > 0) {
    const lastClose = history[history.length - 1].close;
    const pnl = (lastClose - entryPrice) * shares;
    cash += shares * lastClose;
    trades.push({ date: history[history.length-1].date, action: 'CLOSE', shares, price: lastClose, pnl: +pnl.toFixed(2), cashAfter: +cash.toFixed(2) });
    shares = 0;
  }

  return { trades, finalCash: +cash.toFixed(2), maxDrawdown: +maxDrawdown.toFixed(2), equityCurve };
}

// ─── Strategy Metrics ─────────────────────────────────────────────────────────
function calcMetrics(trades, finalCash) {
  const closed = trades.filter(t => t.pnl !== undefined);
  if (!closed.length) return { score: 0 };
  const totalPnL = closed.reduce((s, t) => s + t.pnl, 0);
  const winners = closed.filter(t => t.pnl > 0);
  const losers  = closed.filter(t => t.pnl < 0);
  const winRate = closed.length ? winners.length / closed.length : 0;
  const avgWin  = winners.length ? winners.reduce((s,t)=>s+t.pnl,0)/winners.length : 0;
  const avgLoss = losers.length  ? Math.abs(losers.reduce((s,t)=>s+t.pnl,0)/losers.length) : 0;
  const profitFactor = avgLoss > 0 ? (avgWin * winners.length) / (avgLoss * losers.length) : 999;
  const returnPct = (finalCash - CONFIG.CAPITAL) / CONFIG.CAPITAL * 100;
  const avgHoldDays = closed.filter(t=>t.holdDays).reduce((s,t)=>s+t.holdDays,0) / (closed.filter(t=>t.holdDays).length||1);
  // Score: blend of return, win rate, profit factor
  const score = returnPct * 0.5 + winRate * 100 * 0.3 + Math.min(profitFactor, 5) * 20 * 0.2;
  return { totalPnL: +totalPnL.toFixed(2), returnPct: +returnPct.toFixed(2), winRate: +(winRate*100).toFixed(1),
    avgWin: +avgWin.toFixed(2), avgLoss: +avgLoss.toFixed(2), profitFactor: +profitFactor.toFixed(2),
    totalTrades: closed.length, winners: winners.length, losers: losers.length, avgHoldDays: +avgHoldDays.toFixed(1), score: +score.toFixed(2) };
}

// ─── Parameter Grid Search ────────────────────────────────────────────────────
function gridSearch(strategyName, history) {
  const strategy = STRATEGIES[strategyName];
  if (!strategy) throw new Error('Unknown strategy: ' + strategyName);

  const paramKeys = Object.keys(strategy.params);
  const paramValues = paramKeys.map(k => strategy.params[k]);

  // Build cartesian product of params
  function cartesian(arrays) {
    return arrays.reduce((acc, arr) => acc.flatMap(a => arr.map(b => [...a, b])), [[]]);
  }
  const combos = cartesian(paramValues);
  const results = [];

  for (const combo of combos) {
    const paramObj = Object.fromEntries(paramKeys.map((k, i) => [k, combo[i]]));
    try {
      const signals = strategy.generate(history, paramObj);
      if (!signals.length) continue;
      const { trades, finalCash, maxDrawdown } = backtest(history, signals);
      const metrics = calcMetrics(trades, finalCash);
      results.push({ params: paramObj, metrics, maxDrawdown, finalCash });
    } catch (e) { /* skip invalid param combos */ }
  }

  results.sort((a, b) => b.metrics.score - a.metrics.score);
  return results;
}

// ─── Position Sizing Comparison ───────────────────────────────────────────────
function compareSizingMethods(history, signals) {
  const methods = ['fixed', 'kelly', 'volatility'];
  return methods.map(method => {
    const { trades, finalCash, maxDrawdown } = backtest(history, signals, method);
    const metrics = calcMetrics(trades, finalCash);
    return { method, metrics, maxDrawdown };
  }).sort((a, b) => b.metrics.score - a.metrics.score);
}

// ─── Scenario Analysis ────────────────────────────────────────────────────────
function scenarioAnalysis(symbol, strategyName, bestParams) {
  const strategy = STRATEGIES[strategyName];
  const results = { bull: null, bear: null, sideways: null };

  // Bull: upward trending data
  const bullHistory = generateHistory(symbol, 45).map((d, i, arr) => {
    const trend = 1 + (i / arr.length) * 0.15; // 15% uptrend
    return { ...d, close: +(d.close * trend).toFixed(2), high: +(d.high * trend).toFixed(2), low: +(d.low * trend).toFixed(2) };
  });
  // Bear: downward trending data
  const bearHistory = generateHistory(symbol, 45).map((d, i, arr) => {
    const trend = 1 - (i / arr.length) * 0.18; // 18% downtrend
    return { ...d, close: +(d.close * trend).toFixed(2), high: +(d.high * trend).toFixed(2), low: +(d.low * trend).toFixed(2) };
  });
  // Sideways: mean-reverting data (already roughly sideways from GBM)
  const sidewaysHistory = generateHistory(symbol, 45);

  for (const [scenario, hist] of [['bull', bullHistory], ['bear', bearHistory], ['sideways', sidewaysHistory]]) {
    try {
      const signals = strategy.generate(hist, bestParams);
      const { trades, finalCash, maxDrawdown } = backtest(hist, signals);
      results[scenario] = { metrics: calcMetrics(trades, finalCash), maxDrawdown };
    } catch (e) { results[scenario] = { error: e.message }; }
  }
  return results;
}

// ─── Optimal Trade Targets ─────────────────────────────────────────────────────
function findOptimalTargets(history) {
  const closes = history.map(d => d.close);
  const avgPrice = closes.reduce((s, p) => s + p, 0) / closes.length;
  const volatility = Math.sqrt(closes.map(p => (p - avgPrice) ** 2).reduce((s,v)=>s+v,0) / closes.length) / avgPrice;

  // Optimal targets based on volatility regime
  const targets = {
    conservative: {
      buyDip:   +(avgPrice * (1 - volatility * 0.5)).toFixed(2),
      sellRip:  +(avgPrice * (1 + volatility * 0.5)).toFixed(2),
      stopLoss: +(avgPrice * (1 - volatility * 1.0)).toFixed(2),
      riskReward: 1.0,
    },
    moderate: {
      buyDip:   +(avgPrice * (1 - volatility * 1.0)).toFixed(2),
      sellRip:  +(avgPrice * (1 + volatility * 1.5)).toFixed(2),
      stopLoss: +(avgPrice * (1 - volatility * 1.5)).toFixed(2),
      riskReward: 1.5,
    },
    aggressive: {
      buyDip:   +(avgPrice * (1 - volatility * 1.5)).toFixed(2),
      sellRip:  +(avgPrice * (1 + volatility * 2.5)).toFixed(2),
      stopLoss: +(avgPrice * (1 - volatility * 2.0)).toFixed(2),
      riskReward: 1.67,
    },
  };
  return { avgPrice: +avgPrice.toFixed(2), volatilityPct: +(volatility * 100).toFixed(2), targets };
}

// ─── Main Runner ───────────────────────────────────────────────────────────────
async function runBacktester(symbols = CONFIG.SYMBOLS) {
  if (!fs.existsSync(CONFIG.OUTPUT_DIR)) fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║       📈  STRATEGY BACKTESTER  —  60-Day Window      ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const allResults = {};

  for (const symbol of symbols) {
    console.log(`\n► Backtesting ${symbol}...`);
    const history = generateHistory(symbol, 60);
    const targets = findOptimalTargets(history);

    console.log(`  Price Range: avg $${targets.avgPrice} | Volatility: ${targets.volatilityPct}%`);
    console.log(`  Buy Targets: Conservative $${targets.targets.conservative.buyDip} | Moderate $${targets.targets.moderate.buyDip} | Aggressive $${targets.targets.aggressive.buyDip}`);

    const symbolResults = {};

    for (const stratName of Object.keys(STRATEGIES)) {
      const gridResults = gridSearch(stratName, history);
      if (!gridResults.length) { console.log(`  ⚠  ${stratName}: no valid signals`); continue; }

      const best = gridResults[0];
      const worst = gridResults[gridResults.length - 1];
      const scenarios = scenarioAnalysis(symbol, stratName, best.params);
      const sizingComparison = compareSizingMethods(history, STRATEGIES[stratName].generate(history, best.params));

      symbolResults[stratName] = { bestParams: best.params, bestMetrics: best.metrics, worstMetrics: worst.metrics, scenarios, sizingComparison, optimalTargets: targets };

      const prefix = best.metrics.returnPct >= 0 ? '✅' : '❌';
      console.log(`  ${prefix} ${stratName.padEnd(18)} | Return: ${best.metrics.returnPct>0?'+':''}${best.metrics.returnPct}% | WinRate: ${best.metrics.winRate}% | PF: ${best.metrics.profitFactor} | Trades: ${best.metrics.totalTrades} | Best params: ${JSON.stringify(best.params)}`);
    }

    // Find best strategy for this symbol
    const ranked = Object.entries(symbolResults).sort((a, b) => b[1].bestMetrics.score - a[1].bestMetrics.score);
    if (ranked.length) {
      const [topStrat, topData] = ranked[0];
      console.log(`  🏆 Best strategy: ${topStrat} (score: ${topData.bestMetrics.score})`);
      console.log(`     Sizing: ${topData.sizingComparison[0].method} sizing recommended (score: ${topData.sizingComparison[0].metrics.score})`);
    }

    allResults[symbol] = symbolResults;
  }

  // Save results
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile = path.join(CONFIG.OUTPUT_DIR, `backtest-${ts}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ runAt: new Date().toISOString(), results: allResults }, null, 2));

  console.log(`\n💾 Full backtest results saved: ${outFile}`);
  console.log('══════════════════════════════════════════════════════\n');
  return allResults;
}

// ─── Express API Routes ───────────────────────────────────────────────────────
function registerRoutes(app) {
  app.get('/backtest/run', async (req, res) => {
    const symbols = req.query.symbols ? req.query.symbols.split(',') : CONFIG.SYMBOLS;
    const results = await runBacktester(symbols);
    res.json({ status: 'ok', results });
  });

  app.get('/backtest/strategies', (req, res) => {
    res.json({ strategies: Object.entries(STRATEGIES).map(([name, s]) => ({ name, description: s.description, params: s.params })) });
  });

  app.post('/backtest/custom', (req, res) => {
    const { symbol, strategy, params } = req.body;
    if (!STRATEGIES[strategy]) return res.status(400).json({ error: 'Unknown strategy' });
    const history = generateHistory(symbol || 'AAPL', 60);
    const signals = STRATEGIES[strategy].generate(history, params || {});
    const { trades, finalCash, maxDrawdown } = backtest(history, signals);
    const metrics = calcMetrics(trades, finalCash);
    res.json({ symbol, strategy, params, metrics, maxDrawdown, trades });
  });
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
if (require.main === module) {
  const symbols = process.argv.slice(2).length ? process.argv.slice(2) : CONFIG.SYMBOLS;
  runBacktester(symbols).catch(console.error);
}

module.exports = { runBacktester, backtest, gridSearch, calcMetrics, scenarioAnalysis, registerRoutes };
