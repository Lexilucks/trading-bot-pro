'use strict';

/**
 * chatbot-server.js
 * Express server exposing the VA chatbot as a REST API + WebSocket interface.
 * Single entry point for all chatbot interactions.
 *
 * @module chatbot/chatbot-server
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const path = require('path');

const VAChatbot = require('./va-chatbot');
const { createLogger } = require('../utils/logger');

const logger = createLogger('ChatbotServer');
const PORT = parseInt(process.env.CHATBOT_PORT || '3002', 10);

// ─── App Setup ─────────────────────────────────────────────────────────────

const app = express();
const httpServer = createServer(app);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../public/chatbot')));

// Rate limiting: 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// ─── Chatbot Initialization ────────────────────────────────────────────────

const chatbot = new VAChatbot({
  accountSize: parseFloat(process.env.ACCOUNT_SIZE || '100000'),
  maxRiskPerTrade: parseFloat(process.env.MAX_RISK_PER_TRADE || '0.02'),
  dbPath: process.env.DB_PATH || './data/trading.db',
  alerts: {
    slackWebhook: process.env.SLACK_WEBHOOK_URL,
    discordWebhook: process.env.DISCORD_WEBHOOK_URL,
  },
});

// ─── Request Validation Middleware ─────────────────────────────────────────

function validateChatRequest(req, res, next) {
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({
      error: 'message is required and must be a string',
      code: 'INVALID_MESSAGE',
    });
  }
  if (message.length > 2000) {
    return res.status(400).json({
      error: 'message must be 2000 characters or less',
      code: 'MESSAGE_TOO_LONG',
    });
  }
  next();
}

function requestTimer(req, res, next) {
  req.startTime = Date.now();
  res.on('finish', () => {
    const latency = Date.now() - req.startTime;
    if (latency > 500) {
      logger.warn('Slow response', { path: req.path, latencyMs: latency });
    }
  });
  next();
}

app.use(requestTimer);

// ─── API Routes ────────────────────────────────────────────────────────────

/**
 * POST /api/chat
 * Main chatbot endpoint. Processes a user message and returns a response.
 *
 * @body {{ message: string, sessionId?: string }}
 * @returns {ChatResponse}
 */
app.post('/api/chat', validateChatRequest, async (req, res) => {
  const { message, sessionId = 'default' } = req.body;

  try {
    const response = await chatbot.processMessage(message, sessionId);
    res.json({ success: true, ...response });
  } catch (error) {
    logger.error('Chat endpoint error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      text: 'Sorry, something went wrong. Please try again.',
    });
  }
});

/**
 * POST /api/analyze-trade
 * Analyze a completed trade and provide coaching feedback.
 *
 * @body {Trade} trade object
 */
app.post('/api/analyze-trade', async (req, res) => {
  const trade = req.body;

  if (!trade.symbol || !trade.side || !trade.qty) {
    return res.status(400).json({ error: 'Trade requires symbol, side, and qty' });
  }

  try {
    const analysis = await chatbot.analyzeClosedTrade(trade);
    res.json({ success: true, analysis });
  } catch (error) {
    logger.error('Trade analysis error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/health
 * Health check endpoint.
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime(),
    sessions: chatbot.sessions.activeSessionCount,
    port: PORT,
  });
});

/**
 * GET /api/audit
 * Retrieve audit log entries (last 100).
 */
app.get('/api/audit', (req, res) => {
  try {
    const { sessionId, action, limit = 100 } = req.query;
    const entries = chatbot.audit.query({ sessionId, action, limit: parseInt(limit, 10) });
    res.json({ success: true, entries, count: entries.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/daily-risk-report
 * Generate and return the daily risk report.
 */
app.get('/api/daily-risk-report', async (req, res) => {
  try {
    const response = await chatbot.processMessage('give me my daily risk report', 'system');
    res.json({ success: true, report: response.data, text: response.text });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/market-scan
 * Trigger a market scan and return results.
 */
app.get('/api/market-scan', async (req, res) => {
  try {
    const response = await chatbot.processMessage('scan the market for opportunities', 'system');
    res.json({ success: true, ...response });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/top-picks
 * Get today's top trading opportunities.
 */
app.get('/api/top-picks', async (req, res) => {
  try {
    const response = await chatbot.processMessage("what's the best stock to trade today?", 'system');
    res.json({ success: true, ...response });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/backtest
 * Run a custom backtest.
 *
 * @body {{ strategyDescription: string }}
 */
app.post('/api/backtest', async (req, res) => {
  const { strategyDescription } = req.body;
  if (!strategyDescription) {
    return res.status(400).json({ error: 'strategyDescription is required' });
  }

  try {
    const response = await chatbot.processMessage(
      `test this strategy: ${strategyDescription}`,
      'api-backtest'
    );
    res.json({ success: true, ...response });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/export/trades
 * Export all trades as CSV.
 */
app.get('/api/export/trades', async (req, res) => {
  try {
    const csv = await chatbot.integration.exportToCSV('trades');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="trades.csv"');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/performance
 * Get performance analytics for a period.
 */
app.get('/api/performance', async (req, res) => {
  const { period = 'this month' } = req.query;
  try {
    const response = await chatbot.processMessage(`how did I do ${period}?`, 'system');
    res.json({ success: true, ...response });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Web UI ────────────────────────────────────────────────────────────────

// Serve the chatbot web interface
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/chatbot/index.html'));
});

// ─── Error Handling ────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.path });
});

app.use((error, req, res, _next) => {
  logger.error('Unhandled error', { error: error.message, stack: error.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Server Startup ────────────────────────────────────────────────────────

function startServer() {
  httpServer.listen(PORT, () => {
    logger.info(`VA Chatbot server running on port ${PORT}`, {
      port: PORT,
      env: process.env.NODE_ENV || 'development',
      endpoints: [
        'POST /api/chat',
        'GET  /api/health',
        'GET  /api/market-scan',
        'GET  /api/top-picks',
        'GET  /api/daily-risk-report',
        'POST /api/analyze-trade',
        'POST /api/backtest',
        'GET  /api/performance',
        'GET  /api/export/trades',
        'GET  /api/audit',
      ],
    });
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    httpServer.close(() => {
      chatbot.integration.db.close();
      process.exit(0);
    });
  });

  return httpServer;
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, chatbot };
