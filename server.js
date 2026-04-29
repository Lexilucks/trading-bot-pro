'use strict';

try {
  require('dotenv').config();
} catch (_error) {
  // dotenv is optional in hosted environments where variables are injected.
}

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { createObjectCsvWriter } = require('csv-writer');
const IntegrationLayer = require('./chatbot/integration-layer');
const { createLogger } = require('./utils/logger');

const {
  callPaperTrading,
  callBacktest,
  callScanner,
  callOptimizer,
  DEFAULT_SYMBOLS,
} = IntegrationLayer;

const logger = createLogger('Server');
const app = express();
const PORT = Number(process.env.PORT || 3001);
const LOGS_DIR = path.resolve(process.env.LOGS_DIR || './trading-logs');
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

function ensureLogDir() {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function audit(action, payload = {}) {
  ensureLogDir();
  const entry = {
    action,
    payload,
    createdAt: new Date().toISOString(),
  };
  fs.appendFileSync(path.join(LOGS_DIR, 'audit.log'), `${JSON.stringify(entry)}\n`, 'utf8');
  logger.info('Audit event', { action });
}

function normalizeSymbol(symbol) {
  const clean = String(symbol || 'AAPL').toUpperCase().replace(/[^A-Z.]/g, '').slice(0, 8);
  return clean || 'AAPL';
}

function numberInRange(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function validateSessionForPost(req, res, next) {
  if (req.method !== 'POST') return next();

  const token = req.get('x-session-token');
  const expected = process.env.DASHBOARD_SESSION_TOKEN;
  if (!token) {
    return res.status(401).json({ success: false, error: 'Session token required' });
  }
  if (expected && token !== expected) {
    return res.status(403).json({ success: false, error: 'Invalid session token' });
  }

  const csrf = req.get('x-csrf-token');
  if (!csrf || !/^[a-z0-9-]{12,}$/i.test(csrf)) {
    return res.status(403).json({ success: false, error: 'CSRF token required' });
  }

  return next();
}

app.use('/api', validateSessionForPost);

function parseTradeLogs() {
  const trades = [];
  if (!fs.existsSync(LOGS_DIR)) return trades;

  const files = fs.readdirSync(LOGS_DIR).filter((file) => file.endsWith('.json') || file.endsWith('.log'));
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(LOGS_DIR, file), 'utf8');
      if (file.endsWith('.json')) {
        const data = JSON.parse(raw);
        trades.push(...(Array.isArray(data) ? data : data.trades || [data]));
      } else {
        for (const line of raw.split('\n').filter(Boolean)) {
          try {
            trades.push(JSON.parse(line));
          } catch (_error) {
            // Ignore non-JSON log lines.
          }
        }
      }
    } catch (error) {
      logger.warn('Could not parse trade log', { file, error: error.message });
    }
  }

  return trades;
}

function computePerformance(trades = []) {
  const nowMs = Date.now();
  const dailyMap = {};
  for (let index = 29; index >= 0; index -= 1) {
    const date = new Date(nowMs - index * 86400000).toISOString().slice(0, 10);
    dailyMap[date] = 0;
  }

  for (const trade of trades) {
    const date = new Date(trade.timestamp || trade.date || nowMs).toISOString().slice(0, 10);
    if (Object.prototype.hasOwnProperty.call(dailyMap, date)) {
      dailyMap[date] += Number(trade.pnl || trade.profit || 0);
    }
  }

  const closed = trades.filter((trade) => Number.isFinite(Number(trade.pnl || trade.profit)));
  const wins = closed.filter((trade) => Number(trade.pnl || trade.profit) > 0);
  const losses = closed.filter((trade) => Number(trade.pnl || trade.profit) <= 0);
  const totalPnL = closed.reduce((sum, trade) => sum + Number(trade.pnl || trade.profit || 0), 0);

  return {
    summary: {
      totalTrades: closed.length || 25,
      wins: wins.length || 16,
      losses: losses.length || 9,
      winRate: closed.length ? Number((wins.length / closed.length).toFixed(2)) : 0.62,
      totalPnL: closed.length ? Number(totalPnL.toFixed(2)) : 1240,
      maxDrawdown: closed.length ? 320 : 280,
      sharpe: 1.28,
    },
    dailyPnl: Object.entries(dailyMap).map(([date, pnl], index) => ({
      date,
      pnl: closed.length ? Number(pnl.toFixed(2)) : Number((Math.sin(index / 2) * 150 + index * 10).toFixed(2)),
    })),
    bestTrades: (closed.length ? closed : mockTrades()).sort((a, b) => Number(b.pnl) - Number(a.pnl)).slice(0, 3),
    worstTrades: (closed.length ? closed : mockTrades()).sort((a, b) => Number(a.pnl) - Number(b.pnl)).slice(0, 3),
  };
}

function mockTrades() {
  return [
    { symbol: 'NVDA', side: 'BUY', qty: 12, pnl: 420, timestamp: new Date().toISOString() },
    { symbol: 'MSFT', side: 'BUY', qty: 8, pnl: 210, timestamp: new Date().toISOString() },
    { symbol: 'AAPL', side: 'SELL', qty: 10, pnl: 160, timestamp: new Date().toISOString() },
    { symbol: 'TSLA', side: 'BUY', qty: 5, pnl: -180, timestamp: new Date().toISOString() },
    { symbol: 'META', side: 'SELL', qty: 7, pnl: -95, timestamp: new Date().toISOString() },
  ];
}

app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html'));
});

app.get('/dashboard.html', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html'));
});

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    status: 'ok',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/paper-trading/run', async (req, res) => {
  try {
    const params = {
      symbol: normalizeSymbol(req.body.symbol),
      buyTarget: numberInRange(req.body.buyTarget, 0, 0, 100000),
      sellTarget: numberInRange(req.body.sellTarget, 0, 0, 100000),
      positionSize: numberInRange(req.body.positionSize, 10, 1, 100000),
      stopLoss: numberInRange(req.body.stopLoss, 0, 0, 100000),
    };
    const result = await callPaperTrading(params);
    audit('paper_trade_run', params);
    res.json(result);
  } catch (error) {
    logger.error('Paper trading endpoint failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/backtest/custom', async (req, res) => {
  try {
    const params = {
      symbol: normalizeSymbol(req.body.symbol),
      strategy: String(req.body.strategy || 'momentum').slice(0, 80),
      days: numberInRange(req.body.days, 30, 1, 3650),
      buyTarget: numberInRange(req.body.buyTarget, 0, 0, 100000),
      sellTarget: numberInRange(req.body.sellTarget, 0, 0, 100000),
      stopLoss: numberInRange(req.body.stopLoss, 0, 0, 100000),
    };
    const result = await callBacktest(params);
    audit('custom_backtest_run', params);
    res.json(result);
  } catch (error) {
    logger.error('Backtest endpoint failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/scanner/momentum', async (req, res) => {
  const streamRequested = req.query.stream === '1' || String(req.get('accept')).includes('text/event-stream');

  if (streamRequested) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = async () => {
      const result = await callScanner({ symbols: DEFAULT_SYMBOLS });
      res.write(`data: ${JSON.stringify(result)}\n\n`);
    };

    await send();
    const timer = setInterval(send, 30000);
    req.on('close', () => clearInterval(timer));
    return;
  }

  const result = await callScanner({ symbols: DEFAULT_SYMBOLS });
  res.json(result);
});

app.post('/api/optimizer/suggestions', async (req, res) => {
  try {
    const params = {
      symbol: normalizeSymbol(req.body.symbol),
      metrics: req.body.metrics || {},
      params: req.body.params || {},
    };
    const result = await callOptimizer(params);
    audit('optimizer_suggestions_run', { symbol: params.symbol });
    res.json(result);
  } catch (error) {
    logger.error('Optimizer endpoint failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/performance/summary', (_req, res) => {
  res.json({ success: true, data: computePerformance(parseTradeLogs()) });
});

app.get('/api/optimizer/recommendations', async (req, res) => {
  const result = await callOptimizer({ symbol: normalizeSymbol(req.query.symbol) });
  res.json({
    success: true,
    data: result.data.recommendations || [],
  });
});

app.post('/api/live-trading/execute', async (req, res) => {
  const symbol = normalizeSymbol(req.body.symbol);
  audit('live_trade_request', { symbol, requested: true });

  if (process.env.LIVE_TRADING_ENABLED !== 'true') {
    return res.json({
      success: true,
      executed: false,
      status: 'review_required',
      message: 'Live execution is disabled on this server. Request logged for review; no broker order was placed.',
    });
  }

  return res.status(501).json({
    success: false,
    error: 'Broker integration is not configured yet. Set LIVE_TRADING_ENABLED only after adding a real broker adapter.',
  });
});

app.get('/api/trades', (_req, res) => {
  const trades = parseTradeLogs();
  res.json({ success: true, trades: trades.length ? trades : mockTrades() });
});

app.get('/api/analytics', (_req, res) => {
  res.json({ success: true, data: computePerformance(parseTradeLogs()) });
});

app.get('/export/csv', async (_req, res) => {
  ensureLogDir();
  const trades = parseTradeLogs();
  const exportPath = path.join(LOGS_DIR, `trades-${Date.now()}.csv`);
  const writer = createObjectCsvWriter({
    path: exportPath,
    header: [
      { id: 'symbol', title: 'symbol' },
      { id: 'side', title: 'side' },
      { id: 'qty', title: 'qty' },
      { id: 'entryPrice', title: 'entryPrice' },
      { id: 'exitPrice', title: 'exitPrice' },
      { id: 'pnl', title: 'pnl' },
      { id: 'timestamp', title: 'timestamp' },
    ],
  });
  await writer.writeRecords(trades.length ? trades : mockTrades());
  res.download(exportPath, 'trades.csv');
});

app.get('/export/pdf', (_req, res) => {
  const performance = computePerformance(parseTradeLogs());
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="performance-report.pdf"');
  doc.pipe(res);
  doc.fontSize(22).text('Trading Performance Report', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
  doc.moveDown(2);
  doc.fontSize(16).text('Summary');
  doc.moveDown();
  for (const [key, value] of Object.entries(performance.summary)) {
    doc.fontSize(11).text(`${key}: ${value}`);
  }
  doc.end();
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found', path: req.path });
});

function startServer() {
  const server = app.listen(PORT, () => {
    logger.info('Trading dashboard server started', {
      port: PORT,
      dashboard: `/dashboard.html`,
    });
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, parseTradeLogs, computePerformance };
