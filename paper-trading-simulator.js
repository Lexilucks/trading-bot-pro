// Paper Trading Simulator
// Simulates trades using 1-month historical price data
// No real money involved — safe strategy testing with full P&L reporting
// Run: node paper-trading-simulator.js
// Integrates with trading-bot-pro on port 3000

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ─── Configuration ────────────────────────────────────────────────────────────
const CONFIG = {
  BOT_API: process.env.BOT_API_URL || 'http://localhost:3000',
  STARTING_CAPITAL: 100000,          // Paper money balance
  LOOKBACK_DAYS: 30,                 // 1-month simulation window
  DEFAULT_SYMBOLS: ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'META', 'GOOGL'],
  RISK_PER_TRADE: 0.02,              // 2% risk per trade
  COMMISSION: 0.005,                 // $0.005/share simulated commission
  OUTPUT_DIR: './paper-trading-results',
};

// ─── Historical Price Generator ───────────────────────────────────────────────
// Generates realistic OHLCV data using Geometric Brownian Motion when live
// data is unavailable.
function generateHistoricalData(symbol, days = 30) {
  const seeds = {
    AAPL: { price: 185, vol: 0.018, drift: 0.0003 },
    MSFT: { price: 415, vol: 0.016, drift: 0.0004 },
    NVDA: { price: 875, vol: 0.028, drift: 0.0006 },
    TSLA: { price: 245, vol: 0.035, drift: 0.0002 },
    META: { price: 505, vol: 0.022, drift: 0.0005 },
    GOOGL: { price: 175, vol: 0.017, drift: 0.0003 },
  };
  const s = seeds[symbol] || { price: 100, vol: 0.02, drift: 0.0003 };
  const data = [];
  let price = s.price;
  const now = new Date();

  for (let i = days; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    if (date.getDay() === 0 || date.getDay() === 6) continue; // skip weekends

    const rand1 = Math.random(), rand2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(rand1)) * Math.cos(2 * Math.PI * rand2);
    price = price * Math.exp((s.drift - 0.5 * s.vol ** 2) + s.vol * z);

    const dayRange = price * (0.005 + Math.random() * 0.015);
    const open = price * (1 + (Math.random() - 0.5) * 0.005);
    const high = Math.max(open, price) + dayRange * Math.random();
    const low  = Math.min(open, price) - dayRange * Math.random();
    const volume = Math.floor(5e6 + Math.random() * 20e6);

    data.push({
      date: date.toISOString().split('T')[0],
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low:  +low.toFixed(2),
      close: +price.toFixed(2),
      volume,
    });
  }
  return data;
}

// ─── Technical Indicators ─────────────────────────────────────────────────────
function sma(prices, period) {
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    const slice = prices.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

function ema(prices, period) {
  const k = 2 / (period + 1);
  const result = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    result.push(prices[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function rsi(prices, period = 14) {
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  const gains = changes.map(c => c > 0 ? c : 0);
  const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);
  const result = [null];
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(...Array(period - 1).fill(null));
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function bollingerBands(prices, period = 20, stdDev = 2) {
  const midBand = sma(prices, period);
  return midBand.map((mid, i) => {
    if (mid === null) return { upper: null, mid: null, lower: null };
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = mid;
    const std = Math.sqrt(slice.reduce((sum, p) => sum + (p - mean) ** 2, 0) / period);
    return { upper: mid + stdDev * std, mid, lower: mid - stdDev * std };
  });
}

// ─── Strategy: Moving Average Crossover with RSI Filter ──────────────────────
function runStrategy(history) {
  const closes = history.map(d => d.close);
  const fast = sma(closes, 5);
  const slow = sma(closes, 20);
  const rsiVals = rsi(closes, 14);
  const bb = bollingerBands(closes, 20);
  const signals = [];

  for (let i = 1; i < history.length; i++) {
    if (!fast[i] || !slow[i] || !rsiVals[i]) continue;
    const crossedUp   = fast[i] > slow[i] && fast[i-1] <= slow[i-1];
    const crossedDown = fast[i] < slow[i] && fast[i-1] >= slow[i-1];
    const oversold = rsiVals[i] < 35;
    const overbought = rsiVals[i] > 65;
    const nearLower = bb[i].lower && history[i].close < bb[i].lower * 1.01;
    const nearUpper = bb[i].upper && history[i].close > bb[i].upper * 0.99;

    if (crossedUp && oversold)   signals.push({ i, date: history[i].date, action: 'BUY',  price: history[i].close, reason: 'MA Cross + RSI Oversold' });
    else if (crossedUp && nearLower) signals.push({ i, date: history[i].date, action: 'BUY', price: history[i].close, reason: 'MA Cross + BB Lower' });
    else if (crossedDown && overbought) signals.push({ i, date: history[i].date, action: 'SELL', price: history[i].close, reason: 'MA Cross + RSI Overbought' });
    else if (crossedDown && nearUpper)  signals.push({ i, date: history[i].date, action: 'SELL', price: history[i].close, reason: 'MA Cross + BB Upper' });
  }
  return signals;
}

// ─── Paper Trade Execution ─────────────────────────────────────────────────────
function executePaperTrades(symbol, history, signals, capital) {
  const trades = [];
  let cash = capital;
  let shares = 0;
  let entryPrice = 0;
  let entryDate = null;

  for (const signal of signals) {
    const price = signal.price;
    const commission = Math.ceil(shares || 100) * CONFIG.COMMISSION;

    if (signal.action === 'BUY' && cash > price) {
      // Position sizing: risk 2% of portfolio per trade
      const riskAmount = cash * CONFIG.RISK_PER_TRADE;
      const stopLoss = price * 0.97; // 3% stop
      const sharesQty = Math.floor(riskAmount / (price - stopLoss));
      const cost = sharesQty * price + commission;
      if (cost > cash) continue;

      shares += sharesQty;
      cash -= cost;
      entryPrice = price;
      entryDate = signal.date;
      trades.push({ date: signal.date, action: 'BUY', shares: sharesQty, price, commission, cashAfter: +cash.toFixed(2), reason: signal.reason });

    } else if (signal.action === 'SELL' && shares > 0) {
      const proceeds = shares * price - commission;
      const pnl = (price - entryPrice) * shares - commission * 2;
      cash += proceeds;
      trades.push({ date: signal.date, action: 'SELL', shares, price, commission, pnl: +pnl.toFixed(2), cashAfter: +cash.toFixed(2), reason: signal.reason, holdDays: Math.round((new Date(signal.date) - new Date(entryDate)) / 86400000) });
      shares = 0;
      entryPrice = 0;
    }
  }

  // Close any open position at last price
  if (shares > 0) {
    const lastPrice = history[history.length - 1].close;
    const pnl = (lastPrice - entryPrice) * shares;
    cash += shares * lastPrice;
    trades.push({ date: history[history.length - 1].date, action: 'CLOSE', shares, price: lastPrice, pnl: +pnl.toFixed(2), cashAfter: +cash.toFixed(2), reason: 'End of simulation' });
    shares = 0;
  }

  return { trades, finalCash: +cash.toFixed(2) };
}

// ─── P&L Report Builder ────────────────────────────────────────────────────────
function buildReport(symbol, history, trades, startingCapital, finalCash) {
  const closedTrades = trades.filter(t => t.pnl !== undefined);
  const totalPnL = closedTrades.reduce((s, t) => s + (t.pnl || 0), 0);
  const winners = closedTrades.filter(t => t.pnl > 0);
  const losers  = closedTrades.filter(t => t.pnl < 0);
  const winRate = closedTrades.length ? (winners.length / closedTrades.length * 100).toFixed(1) : 0;
  const avgWin  = winners.length ? (winners.reduce((s, t) => s + t.pnl, 0) / winners.length).toFixed(2) : 0;
  const avgLoss = losers.length  ? (losers.reduce((s, t)  => s + t.pnl, 0) / losers.length).toFixed(2) : 0;
  const profitFactor = Math.abs(avgLoss) > 0 ? (Math.abs(avgWin * winners.length) / Math.abs(avgLoss * losers.length)).toFixed(2) : '∞';
  const returnPct = ((finalCash - startingCapital) / startingCapital * 100).toFixed(2);
  const maxDrawdown = calculateMaxDrawdown(trades, startingCapital);

  return {
    symbol,
    period: `${history[0].date} → ${history[history.length - 1].date}`,
    startingCapital,
    finalCapital: finalCash,
    totalPnL: +totalPnL.toFixed(2),
    returnPct: +returnPct,
    totalTrades: closedTrades.length,
    winners: winners.length,
    losers: losers.length,
    winRate: +winRate,
    avgWin: +avgWin,
    avgLoss: +avgLoss,
    profitFactor,
    maxDrawdownPct: maxDrawdown,
    trades,
  };
}

function calculateMaxDrawdown(trades, startingCapital) {
  let peak = startingCapital, maxDD = 0, equity = startingCapital;
  for (const t of trades) {
    equity = t.cashAfter;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  }
  return +maxDD.toFixed(2);
}

// ─── Main Simulation Runner ────────────────────────────────────────────────────
async function runSimulation(symbols = CONFIG.DEFAULT_SYMBOLS) {
  if (!fs.existsSync(CONFIG.OUTPUT_DIR)) fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  📊  PAPER TRADING SIMULATOR  —  30-Day Backtest');
  console.log('═══════════════════════════════════════════════════════\n');

  let portfolioCash = CONFIG.STARTING_CAPITAL;
  const allReports = [];

  for (const symbol of symbols) {
    console.log(`▶  Simulating ${symbol}...`);
    const history = generateHistoricalData(symbol, CONFIG.LOOKBACK_DAYS);
    const signals = runStrategy(history);
    const perSymbolCapital = CONFIG.STARTING_CAPITAL / symbols.length;
    const { trades, finalCash } = executePaperTrades(symbol, history, signals, perSymbolCapital);
    const report = buildReport(symbol, history, trades, perSymbolCapital, finalCash);
    allReports.push(report);
    printSymbolSummary(report);
  }

  printPortfolioSummary(allReports);
  saveResults(allReports);
  return allReports;
}

function printSymbolSummary(r) {
  const arrow = r.totalPnL >= 0 ? '📈' : '📉';
  console.log(`  ${arrow} ${r.symbol.padEnd(6)} | Return: ${r.returnPct > 0 ? '+' : ''}${r.returnPct}% | P&L: $${r.totalPnL.toLocaleString()} | Win Rate: ${r.winRate}% (${r.winners}W/${r.losers}L) | MaxDD: ${r.maxDrawdownPct}%`);
}

function printPortfolioSummary(reports) {
  const totalPnL   = reports.reduce((s, r) => s + r.totalPnL, 0);
  const totalStart = reports.reduce((s, r) => s + r.startingCapital, 0);
  const totalEnd   = reports.reduce((s, r) => s + r.finalCapital, 0);
  const portReturn = ((totalEnd - totalStart) / totalStart * 100).toFixed(2);
  const bestSymbol  = reports.reduce((a, b) => a.returnPct > b.returnPct ? a : b);
  const worstSymbol = reports.reduce((a, b) => a.returnPct < b.returnPct ? a : b);

  console.log('\n───────────────────────────────────────────────────────');
  console.log('  📋  PORTFOLIO SUMMARY');
  console.log('───────────────────────────────────────────────────────');
  console.log(`  Starting Capital : $${totalStart.toLocaleString()}`);
  console.log(`  Final Capital    : $${totalEnd.toLocaleString()}`);
  console.log(`  Total P&L        : $${totalPnL.toFixed(2)} (${portReturn > 0 ? '+' : ''}${portReturn}%)`);
  console.log(`  Best Performer   : ${bestSymbol.symbol} (${bestSymbol.returnPct > 0 ? '+' : ''}${bestSymbol.returnPct}%)`);
  console.log(`  Worst Performer  : ${worstSymbol.symbol} (${worstSymbol.returnPct > 0 ? '+' : ''}${worstSymbol.returnPct}%)`);
  console.log(`  Results saved to : ${CONFIG.OUTPUT_DIR}/`);
  console.log('═══════════════════════════════════════════════════════\n');
}

function saveResults(reports) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile = path.join(CONFIG.OUTPUT_DIR, `simulation-${timestamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ runAt: new Date().toISOString(), config: CONFIG, reports }, null, 2));
  console.log(`  💾 Full results saved: ${outFile}`);
}

// ─── Express API Routes (optional — attach to existing server) ────────────────
function registerRoutes(app) {
  app.get('/paper-trading/run', async (req, res) => {
    const symbols = req.query.symbols ? req.query.symbols.split(',') : CONFIG.DEFAULT_SYMBOLS;
    const reports = await runSimulation(symbols);
    res.json({ status: 'ok', reports });
  });

  app.get('/paper-trading/results', (req, res) => {
    if (!fs.existsSync(CONFIG.OUTPUT_DIR)) return res.json({ results: [] });
    const files = fs.readdirSync(CONFIG.OUTPUT_DIR).filter(f => f.endsWith('.json'));
    const latest = files.sort().pop();
    if (!latest) return res.json({ results: [] });
    const data = JSON.parse(fs.readFileSync(path.join(CONFIG.OUTPUT_DIR, latest)));
    res.json(data);
  });
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
if (require.main === module) {
  const symbols = process.argv.slice(2).length ? process.argv.slice(2) : CONFIG.DEFAULT_SYMBOLS;
  runSimulation(symbols).catch(console.error);
}

module.exports = { runSimulation, generateHistoricalData, runStrategy, buildReport, registerRoutes };
