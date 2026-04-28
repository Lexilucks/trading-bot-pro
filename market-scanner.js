// Real-Time Market Scanner
// Monitors 30+ stocks, alerts on breakout patterns, ranks by momentum
// Run standalone: node market-scanner.js
// Or attach to existing Express server via registerRoutes(app)

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

// ─── Watchlist ────────────────────────────────────────────────────────────────
const WATCHLIST = {
  MEGA_CAP: ['AAPL','MSFT','NVDA','GOOGL','META','AMZN','TSLA','BRK','LLY','V'],
  GROWTH:   ['AMD','PLTR','SNOW','CRWD','NET','DDOG','SHOP','MELI','SQ','COIN'],
  ETF:      ['SPY','QQQ','IWM','XLK','XLE','XLF','GLD','TLT','ARKK','SOXS'],
  MOMENTUM: ['SMCI','MSTR','ARM','ASML','TSM','AMAT','LRCX','KLAC','ONTO','ENTG'],
};
const ALL_SYMBOLS = [...new Set(Object.values(WATCHLIST).flat())];

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG = {
  SCAN_INTERVAL_MS: 30000,     // scan every 30 seconds
  ALERT_LOG: './scanner-alerts.log',
  RESULTS_DIR: './scanner-results',
  BREAKOUT_THRESHOLD: 0.02,   // 2% above N-day high = breakout
  MOMENTUM_PERIOD: 14,
  VOLUME_SURGE_MULT: 1.5,     // 1.5x average volume = surge
  RSI_OVERSOLD: 30,
  RSI_OVERBOUGHT: 70,
};

// ─── Live Price Simulator ─────────────────────────────────────────────────────
// Simulates real-time tick data. Replace simulatePrice() with a real market
// data feed (Alpaca, Polygon.io, Yahoo Finance, etc.) in production.
const _priceState = {};
function initPrice(symbol) {
  const base = {
    AAPL:185, MSFT:415, NVDA:875, GOOGL:175, META:505, AMZN:185, TSLA:245,
    BRK:420,  LLY:800,  V:280,    AMD:165,   PLTR:25,  SNOW:155, CRWD:340,
    NET:110,  DDOG:120, SHOP:70,  MELI:1800, SQ:80,    COIN:220,
    SPY:520,  QQQ:440,  IWM:200,  XLK:220,  XLE:90,   XLF:40,   GLD:230,
    TLT:95,   ARKK:55,  SOXS:15,  SMCI:900, MSTR:600, ARM:100,  ASML:950,
    TSM:150,  AMAT:220, LRCX:900, KLAC:780, ONTO:200, ENTG:115,
  };
  if (!_priceState[symbol]) {
    _priceState[symbol] = {
      price: base[symbol] || 100,
      vol: 0.015 + Math.random() * 0.02,
      prevClose: base[symbol] || 100,
      dayOpen: base[symbol] || 100,
      dayHigh: base[symbol] || 100,
      dayLow: base[symbol] || 100,
      priceHistory: Array.from({ length: 20 }, (_, i) => ({
        close: (base[symbol] || 100) * (1 + (Math.random() - 0.48) * 0.015),
        volume: Math.floor(3e6 + Math.random() * 15e6),
      })),
      avgVolume: 8e6,
      lastScan: null,
    };
  }
}

function simulatePrice(symbol) {
  initPrice(symbol);
  const s = _priceState[symbol];
  const z = Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());
  s.price = +(s.price * (1 + s.vol / Math.sqrt(252 * 78) * z)).toFixed(2);
  s.dayHigh = Math.max(s.dayHigh, s.price);
  s.dayLow  = Math.min(s.dayLow,  s.price);
  const volume = Math.floor(s.avgVolume * (0.5 + Math.random() * 1.5));
  s.priceHistory.push({ close: s.price, volume });
  if (s.priceHistory.length > 60) s.priceHistory.shift();
  s.avgVolume = s.priceHistory.reduce((sum, d) => sum + d.volume, 0) / s.priceHistory.length;
  const changePct = (s.price - s.prevClose) / s.prevClose * 100;
  return {
    symbol, price: s.price, prevClose: s.prevClose, open: s.dayOpen,
    high: s.dayHigh, low: s.dayLow, volume,
    avgVolume: Math.floor(s.avgVolume), changePct: +changePct.toFixed(2),
    priceHistory: s.priceHistory,
    timestamp: new Date().toISOString(),
  };
}

// ─── Technical Indicators ─────────────────────────────────────────────────────
function sma(arr, period) {
  if (arr.length < period) return null;
  return arr.slice(-period).reduce((a, b) => a + b, 0) / period;
}
function rsi(prices, period = 14) {
  if (prices.length < period + 1) return null;
  const changes = prices.slice(-period - 1).slice(1).map((p, i) => p - prices.slice(-period - 1)[i]);
  const avgGain = changes.filter(c => c > 0).reduce((s, c) => s + c, 0) / period;
  const avgLoss = changes.filter(c => c < 0).reduce((s, c) => s + Math.abs(c), 0) / period;
  return avgLoss === 0 ? 100 : +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(2);
}
function atr(priceHistory, period = 14) {
  if (priceHistory.length < period) return null;
  const trs = priceHistory.slice(-period).map((d, i, arr) => {
    if (i === 0) return d.close * 0.01;
    return Math.max(d.high || d.close * 1.005, arr[i-1].close) - Math.min(d.low || d.close * 0.995, arr[i-1].close);
  });
  return +(trs.reduce((a, b) => a + b, 0) / trs.length).toFixed(4);
}
function momentum(prices, period = 14) {
  if (prices.length < period + 1) return null;
  const current = prices[prices.length - 1];
  const past = prices[prices.length - 1 - period];
  return +((current - past) / past * 100).toFixed(2);
}

// ─── Pattern Detection ────────────────────────────────────────────────────────
function detectBreakouts(tick) {
  const closes  = tick.priceHistory.map(d => d.close);
  const volumes = tick.priceHistory.map(d => d.volume);
  const alerts  = [];

  // 20-day high breakout
  const high20 = Math.max(...closes.slice(-20));
  if (tick.price > high20 * (1 + CONFIG.BREAKOUT_THRESHOLD)) {
    alerts.push({ type: 'BREAKOUT_HIGH', strength: 'STRONG', message: `Price $${tick.price} broke above 20-day high $${high20.toFixed(2)}` });
  }
  // 20-day low breakdown
  const low20 = Math.min(...closes.slice(-20));
  if (tick.price < low20 * (1 - CONFIG.BREAKOUT_THRESHOLD)) {
    alerts.push({ type: 'BREAKDOWN_LOW', strength: 'STRONG', message: `Price $${tick.price} broke below 20-day low $${low20.toFixed(2)}` });
  }
  // Volume surge with price move
  const volSurge = tick.volume / tick.avgVolume;
  if (volSurge >= CONFIG.VOLUME_SURGE_MULT && Math.abs(tick.changePct) > 1.5) {
    const dir = tick.changePct > 0 ? 'UP' : 'DOWN';
    alerts.push({ type: `VOLUME_SURGE_${dir}`, strength: volSurge > 2 ? 'STRONG' : 'MODERATE',
      message: `Volume ${volSurge.toFixed(1)}x avg with ${tick.changePct}% price move` });
  }
  // Gap up/down at open
  const gapPct = (tick.open - tick.prevClose) / tick.prevClose * 100;
  if (Math.abs(gapPct) > 1.5) {
    const dir = gapPct > 0 ? 'UP' : 'DOWN';
    alerts.push({ type: `GAP_${dir}`, strength: Math.abs(gapPct) > 3 ? 'STRONG' : 'MODERATE',
      message: `Gapped ${dir} ${Math.abs(gapPct).toFixed(2)}% from prev close $${tick.prevClose}` });
  }
  // RSI extremes
  const rsiVal = rsi(closes);
  if (rsiVal !== null) {
    if (rsiVal < CONFIG.RSI_OVERSOLD)  alerts.push({ type: 'RSI_OVERSOLD',  strength: rsiVal < 20 ? 'STRONG' : 'MODERATE', message: `RSI ${rsiVal} — oversold` });
    if (rsiVal > CONFIG.RSI_OVERBOUGHT) alerts.push({ type: 'RSI_OVERBOUGHT', strength: rsiVal > 80 ? 'STRONG' : 'MODERATE', message: `RSI ${rsiVal} — overbought` });
  }
  // Golden/Death cross (SMA 5/20)
  const fast = sma(closes, 5), slow = sma(closes, 20);
  const prevFast = sma(closes.slice(0, -1), 5), prevSlow = sma(closes.slice(0, -1), 20);
  if (fast && slow && prevFast && prevSlow) {
    if (fast > slow && prevFast <= prevSlow) alerts.push({ type: 'GOLDEN_CROSS', strength: 'MODERATE', message: `SMA5 crossed above SMA20 (golden cross)` });
    if (fast < slow && prevFast >= prevSlow) alerts.push({ type: 'DEATH_CROSS',  strength: 'MODERATE', message: `SMA5 crossed below SMA20 (death cross)` });
  }
  return alerts;
}

// ─── Momentum Scoring ─────────────────────────────────────────────────────────
function scoreMomentum(tick) {
  const closes  = tick.priceHistory.map(d => d.close);
  const rsiVal  = rsi(closes) || 50;
  const mom14   = momentum(closes, Math.min(14, closes.length - 1)) || 0;
  const mom5    = momentum(closes, Math.min(5,  closes.length - 1)) || 0;
  const volRatio = tick.volume / (tick.avgVolume || 1);
  // Composite score: momentum + RSI bias + volume confirmation
  const score = mom14 * 0.5 + mom5 * 0.3 + (volRatio - 1) * 10 * 0.2;
  return {
    rsi: rsiVal, momentum14: mom14, momentum5: mom5, volumeRatio: +volRatio.toFixed(2),
    score: +score.toFixed(2),
    trend: score > 5 ? 'STRONG_UP' : score > 1 ? 'UP' : score < -5 ? 'STRONG_DOWN' : score < -1 ? 'DOWN' : 'NEUTRAL',
  };
}

// ─── Scanner Core ─────────────────────────────────────────────────────────────
class MarketScanner extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this.lastResults = {};
    this.alertHistory = [];
    this.scanCount = 0;
    if (!fs.existsSync(CONFIG.RESULTS_DIR)) fs.mkdirSync(CONFIG.RESULTS_DIR, { recursive: true });
  }

  scan() {
    const results = [];
    for (const symbol of ALL_SYMBOLS) {
      const tick = simulatePrice(symbol);
      const alerts = detectBreakouts(tick);
      const momentumScore = scoreMomentum(tick);
      const closes = tick.priceHistory.map(d => d.close);
      const result = {
        symbol, price: tick.price, changePct: tick.changePct,
        high: tick.high, low: tick.low, volume: tick.volume,
        avgVolume: tick.avgVolume, volumeRatio: +(tick.volume / tick.avgVolume).toFixed(2),
        rsi: momentumScore.rsi, momentum: momentumScore,
        alerts, alertCount: alerts.length,
        strongAlerts: alerts.filter(a => a.strength === 'STRONG').length,
        timestamp: tick.timestamp,
      };
      this.lastResults[symbol] = result;
      if (alerts.length > 0) {
        this.alertHistory.push(...alerts.map(a => ({ ...a, symbol, price: tick.price, time: tick.timestamp })));
        if (this.alertHistory.length > 500) this.alertHistory.splice(0, this.alertHistory.length - 500);
        this.emit('alert', { symbol, alerts, tick });
        this.logAlerts(symbol, alerts, tick.price);
      }
      results.push(result);
    }
    // Rank by momentum score
    results.sort((a, b) => b.momentum.score - a.momentum.score);
    this.scanCount++;
    this.emit('scan_complete', { results, scanCount: this.scanCount, timestamp: new Date().toISOString() });
    return results;
  }

  logAlerts(symbol, alerts, price) {
    const lines = alerts.map(a =>
      `[${new Date().toISOString()}] [${a.strength}] ${symbol} @$${price} — ${a.type}: ${a.message}`
    );
    fs.appendFileSync(CONFIG.ALERT_LOG, lines.join('\n') + '\n');
  }

  start() {
    if (this.running) return;
    this.running = true;
    console.log(`\n🔍 Market Scanner started — watching ${ALL_SYMBOLS.length} symbols`);
    console.log(`   Scan interval: ${CONFIG.SCAN_INTERVAL_MS / 1000}s | Alert log: ${CONFIG.ALERT_LOG}\n`);

    const runScan = () => {
      const results = this.scan();
      this.printTopMomentum(results);
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      fs.writeFileSync(path.join(CONFIG.RESULTS_DIR, `scan-${ts}.json`), JSON.stringify({ results, scanCount: this.scanCount }, null, 2));
    };

    runScan(); // immediate first scan
    this._timer = setInterval(runScan, CONFIG.SCAN_INTERVAL_MS);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this.running = false;
    console.log(`\n🛑 Market Scanner stopped after ${this.scanCount} scans`);
  }

  printTopMomentum(results, topN = 10) {
    const topUp   = results.filter(r => r.momentum.score > 0).slice(0, topN);
    const topDown = [...results].sort((a,b) => a.momentum.score - b.momentum.score).filter(r => r.momentum.score < 0).slice(0, 5);
    const alertSymbols = results.filter(r => r.alertCount > 0);

    console.log(`\n[SCAN #${this.scanCount} — ${new Date().toLocaleTimeString()}]`);
    console.log('  🚀 TOP MOMENTUM:');
    topUp.forEach((r, i) => {
      const trend = r.momentum.trend;
      console.log(`    ${(i+1).toString().padStart(2)}. ${r.symbol.padEnd(6)} $${r.price.toFixed(2).padStart(8)} | ${r.changePct > 0 ? '+' : ''}${r.changePct}% | Score: ${r.momentum.score.toFixed(1)} [${trend}] RSI:${r.rsi} Vol:${r.volumeRatio}x`);
    });
    if (topDown.length) {
      console.log('  📉 BOTTOM MOMENTUM:');
      topDown.forEach(r => console.log(`     ${r.symbol.padEnd(6)} $${r.price.toFixed(2)} | ${r.changePct}% | Score: ${r.momentum.score.toFixed(1)}`));
    }
    if (alertSymbols.length) {
      console.log(`  🔔 ALERTS (${alertSymbols.length} symbols):`);
      alertSymbols.slice(0, 8).forEach(r => r.alerts.forEach(a =>
        console.log(`     [${a.strength}] ${r.symbol} $${r.price}: ${a.message}`)
      ));
    }
  }

  getTopMomentum(n = 20) {
    return Object.values(this.lastResults).sort((a, b) => b.momentum.score - a.momentum.score).slice(0, n);
  }
  getAlerts(n = 50) {
    return this.alertHistory.slice(-n).reverse();
  }
  getBreakouts() {
    return Object.values(this.lastResults).filter(r => r.alerts.some(a => a.type.includes('BREAKOUT') || a.type.includes('GOLDEN'))).sort((a, b) => b.strongAlerts - a.strongAlerts);
  }
}

// ─── Singleton scanner instance ───────────────────────────────────────────────
const scanner = new MarketScanner();

// ─── Express API Routes ───────────────────────────────────────────────────────
function registerRoutes(app) {
  // Start scanner when server starts (call once)
  if (!scanner.running) scanner.start();

  app.get('/scanner/status', (req, res) => {
    res.json({ running: scanner.running, scanCount: scanner.scanCount, watchlistSize: ALL_SYMBOLS.length, symbols: ALL_SYMBOLS });
  });
  app.get('/scanner/momentum', (req, res) => {
    const n = parseInt(req.query.n) || 20;
    res.json({ ranked: scanner.getTopMomentum(n), timestamp: new Date().toISOString() });
  });
  app.get('/scanner/alerts', (req, res) => {
    const n = parseInt(req.query.n) || 50;
    res.json({ alerts: scanner.getAlerts(n), total: scanner.alertHistory.length });
  });
  app.get('/scanner/breakouts', (req, res) => {
    res.json({ breakouts: scanner.getBreakouts() });
  });
  app.get('/scanner/symbol/:symbol', (req, res) => {
    const sym = req.params.symbol.toUpperCase();
    const result = scanner.lastResults[sym];
    if (!result) return res.status(404).json({ error: 'Symbol not in watchlist' });
    res.json(result);
  });
  app.get('/scanner/watchlist', (req, res) => {
    res.json(WATCHLIST);
  });
  // SSE stream for real-time alerts
  app.get('/scanner/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const onAlert = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    scanner.on('alert', onAlert);
    req.on('close', () => scanner.off('alert', onAlert));
  });
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
if (require.main === module) {
  scanner.start();
  // Run for 5 scans then exit when standalone
  scanner.on('scan_complete', ({ scanCount }) => {
    if (scanCount >= 3) { scanner.stop(); process.exit(0); }
  });
}

module.exports = { scanner, MarketScanner, ALL_SYMBOLS, WATCHLIST, registerRoutes };
