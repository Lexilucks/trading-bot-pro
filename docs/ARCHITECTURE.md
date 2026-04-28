# Trading Bot Pro - System Architecture

## Overview

Trading Bot Pro is a unified trading ecosystem where all analysis, paper trading, backtesting, and optimization modules are orchestrated through a single VA (Virtual Assistant) chatbot interface.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        User Interface Layer                          │
│                                                                     │
│   HTTP REST API          Web UI              CLI / Direct Calls     │
│   POST /api/chat      chatbot/index.html      node va-chatbot.js    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                      VA Chatbot Server (Port 3002)                   │
│                       chatbot/chatbot-server.js                      │
│                                                                     │
│  • Express REST API with rate limiting + helmet security            │
│  • Health checks, audit log retrieval, CSV exports                  │
│  • Delegates ALL business logic to VAChatbot class                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                        VAChatbot (Control Center)                    │
│                         chatbot/va-chatbot.js                        │
│                                                                     │
│  ┌───────────────┐  ┌──────────────────┐  ┌────────────────────┐  │
│  │  NLP Engine   │  │  Session Manager │  │    Audit Logger    │  │
│  │ nlp-engine.js │  │session-manager.js│  │  utils/audit-log.js│  │
│  │               │  │                  │  │                    │  │
│  │ Intent Parse  │  │ Multi-session    │  │ Every decision     │  │
│  │ Entity Extract│  │ Context tracking │  │ logged with reason │  │
│  │ Strategy Parse│  │ Turn history     │  │                    │  │
│  └───────────────┘  └──────────────────┘  └────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                     Integration Layer (Orchestrator)                  │
│                    chatbot/integration-layer.js                       │
│                                                                     │
│  Routes analysis requests across all 4 modules + analytics          │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   Trading Module Layer                       │   │
│  │                                                             │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │   │
│  │  │    Paper     │  │  Strategy    │  │     Market       │  │   │
│  │  │   Trading    │  │  Backtester  │  │     Scanner      │  │   │
│  │  │  Simulator   │  │              │  │                  │  │   │
│  │  │              │  │  2yr backtest│  │  Breakout detect │  │   │
│  │  │ GBM sim w/   │  │  MA cross    │  │  Momentum scan   │  │   │
│  │  │ slippage     │  │  RSI/BB/MACD │  │  Volume surge    │  │   │
│  │  │ position mgmt│  │  Grid search │  │  Multi-pattern   │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘  │   │
│  │                                                             │   │
│  │  ┌──────────────────────┐  ┌──────────────────────────┐    │   │
│  │  │   Performance        │  │   Analytics Dashboard    │    │   │
│  │  │    Optimizer         │  │   (Port 3001)            │    │   │
│  │  │                      │  │                          │    │   │
│  │  │ A/B strategy test    │  │  Real-time P&L           │    │   │
│  │  │ Kelly position size  │  │  Daily charts            │    │   │
│  │  │ Sharpe optimization  │  │  Risk metrics            │    │   │
│  │  │ Parameter grid search│  │  CSV/PDF export          │    │   │
│  │  └──────────────────────┘  └──────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                      Persistence Layer                               │
│                       database/db.js                                 │
│                     SQLite (better-sqlite3)                          │
│                                                                     │
│  trades │ backtest_results │ scan_alerts │ optimizer_recs │ audit   │
└──────────────────────────────────────────────────────────────────────┘
```

## Data Flow: "Should I buy AAPL?"

```
User: "Should I buy AAPL?"
         │
         ▼
NLPEngine.parseIntent()
  → intent: should_buy
  → entities: { symbol: 'AAPL' }
  → confidence: 0.90
         │
         ▼
VAChatbot.handleShouldBuy()
  ┌──────┴──────────────────────────────┐
  │ Parallel execution (Promise.all):   │
  │                                     │
  │ 1. runMicroBacktest('AAPL')         │
  │    → winRate, profitFactor, sharpe  │
  │                                     │
  │ 2. getOptimizerRating('AAPL')       │
  │    → grade, score                   │
  │                                     │
  │ 3. getScannerSignal('AAPL')         │
  │    → pattern, strength              │
  └──────┬──────────────────────────────┘
         │
         ▼
calculateKellyPositionSize()
  → fullKelly: 20 shares
  → halfKelly: 10 shares (recommended)
  → dollarAmount: $1,850
         │
         ▼
buildBuyRecommendation()
  → combinedScore = 0.40*winRate + 0.40*optimizerScore + 0.20*scanStrength
  → signal: BUY | WATCH | AVOID
  → narrative text
         │
         ▼
AuditLog.log({ action: 'buy_recommendation', symbol: 'AAPL', ... })
         │
         ▼
Response: {
  text: "📊 Analysis for AAPL:
Signal: BUY (78% confidence)...",
  data: { symbol, signal, confidence, positionSize, backtest, ... },
  charts: [equityCurve],
  meta: { intent, latencyMs, sessionId, timestamp }
}
```

## Module Responsibilities

| Module | Responsibility |
|--------|---------------|
| `va-chatbot.js` | Single entry point. Routes intents to handlers. |
| `nlp-engine.js` | Parses natural language → structured intents + entities |
| `integration-layer.js` | Orchestrates cross-module analysis pipelines |
| `session-manager.js` | Maintains per-user conversation context |
| `audit-log.js` | Immutable audit trail of all decisions |
| `chatbot-server.js` | Express HTTP API + rate limiting + security headers |
| `database/db.js` | SQLite persistence for all data types |
| `utils/logger.js` | Structured logging at DEBUG/INFO/WARN/ERROR |

## Performance Targets

- **Response time**: <500ms for any query (achieved via parallel Promise.all execution)
- **DB queries**: <10ms per query (SQLite WAL mode + indexed columns)
- **Memory**: <200MB under normal load
- **Throughput**: 100 requests/15min per IP (rate limited)

## Security Model

- No API keys in code — all via environment variables
- Helmet.js security headers on all HTTP responses  
- Rate limiting prevents abuse
- Paper/live trade distinction enforced at DB layer
- Audit log captures every decision with timestamp
- Non-root Docker user in production
