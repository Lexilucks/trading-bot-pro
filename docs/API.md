# API Reference

## Base URL
`http://localhost:3002`

---

## Endpoints

### POST /api/chat

The primary endpoint. Accepts natural language messages and returns full analysis.

**Request Body**
```json
{
  "message": "Should I buy AAPL?",
  "sessionId": "optional-session-identifier"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| message | string | Yes | User's natural language query (max 2000 chars) |
| sessionId | string | No | Session ID for context persistence. Defaults to "default" |

**Response**
```json
{
  "success": true,
  "text": "📊 Analysis for AAPL:\n\nSignal: BUY (82% confidence)...",
  "data": {
    "symbol": "AAPL",
    "signal": "BUY",
    "confidence": 0.82,
    "positionSize": {
      "halfKelly": 11,
      "fullKelly": 22,
      "dollarAmount": 2035,
      "halfKellyFraction": 0.020
    },
    "backtest": {
      "winRate": 0.62,
      "profitFactor": 1.87,
      "sharpeRatio": 1.31,
      "maxDrawdown": 0.11,
      "totalTrades": 130
    },
    "optimizer": { "grade": "B+", "score": 0.78 },
    "scanner": { "pattern": "BREAKOUT", "strength": 0.82 },
    "riskViolation": null
  },
  "charts": [
    { "type": "line", "label": "Equity Curve", "data": [...] }
  ],
  "alerts": [],
  "meta": {
    "intent": "should_buy",
    "confidence": 0.90,
    "latencyMs": 187,
    "sessionId": "user-123",
    "timestamp": "2026-04-27T10:30:00.000Z"
  }
}
```

**Error Response (400)**
```json
{
  "error": "message is required and must be a string",
  "code": "INVALID_MESSAGE"
}
```

---

### GET /api/health

Returns server health status.

**Response**
```json
{
  "status": "ok",
  "timestamp": "2026-04-27T10:30:00.000Z",
  "version": "1.0.0",
  "uptime": 3600.5,
  "sessions": 4,
  "port": 3002
}
```

---

### GET /api/top-picks

Returns today's top trading opportunities from the market scanner.

**Response**
```json
{
  "success": true,
  "data": {
    "opportunities": [
      {
        "symbol": "AAPL",
        "pattern": "BREAKOUT",
        "confidence": 0.87,
        "riskReward": 2.8,
        "entryPrice": 185.00,
        "targetPrice": 196.00,
        "stopPrice": 179.00
      }
    ]
  },
  "text": "📡 Today's Top 3 Opportunities:..."
}
```

---

### GET /api/market-scan

Triggers a full market scan and returns all alerts.

**Response**
```json
{
  "success": true,
  "data": {
    "alerts": [
      {
        "symbol": "AAPL",
        "pattern": "BREAKOUT",
        "strength": 0.90,
        "volumeRatio": 2.5
      }
    ]
  }
}
```

---

### GET /api/daily-risk-report

Returns the daily risk report for open positions.

**Response**
```json
{
  "success": true,
  "text": "🛡️ Daily Risk Report:...",
  "report": {
    "openPositions": 2,
    "capitalAtRisk": 3500,
    "capitalAtRiskPct": 0.035,
    "maxPossibleLoss": 1750,
    "dailyLossLimit": 10000,
    "breaches": [],
    "generatedAt": "2026-04-27T10:30:00.000Z"
  }
}
```

---

### GET /api/performance

Returns performance analytics for a time period.

**Query Parameters**
| Param | Default | Description |
|-------|---------|-------------|
| period | "this month" | Time period (e.g., "yesterday", "last week", "this month") |

**Response**
```json
{
  "success": true,
  "text": "📈 Performance Summary...",
  "data": {
    "totalPnl": 1890.25,
    "winRate": 0.65,
    "totalTrades": 48,
    "maxDrawdown": 0.08,
    "sharpeRatio": 1.60,
    "bestTrade": 380,
    "worstTrade": -190
  }
}
```

---

### POST /api/backtest

Run a strategy backtest from a natural language description.

**Request Body**
```json
{
  "strategyDescription": "buy at 50-day MA, sell at 20-day MA, stop loss 2%"
}
```

**Response**
```json
{
  "success": true,
  "text": "🔬 Backtest Results:\n\nGrade: B...",
  "data": {
    "strategy": {
      "name": "50/20 SMA Crossover",
      "entryPeriod": 50,
      "exitPeriod": 20,
      "stopLossPercent": 0.02
    },
    "backtest": {
      "winRate": 0.60,
      "profitFactor": 1.85,
      "sharpeRatio": 1.25,
      "maxDrawdown": 0.13,
      "totalTrades": 145
    },
    "grade": "B",
    "tweaks": [
      "Consider adding market regime filter (only trade above 200 MA)"
    ]
  }
}
```

---

### POST /api/analyze-trade

Analyze a completed trade and get coaching feedback.

**Request Body**
```json
{
  "symbol": "AAPL",
  "side": "BUY",
  "qty": 10,
  "entryPrice": 185.00,
  "exitPrice": 191.00,
  "pnl": 60.00,
  "executionMs": 45,
  "timestamp": "2026-04-27T10:00:00Z",
  "strategyName": "MA Crossover"
}
```

**Response**
```json
{
  "success": true,
  "analysis": {
    "trade": { ... },
    "matchedStrategy": { "name": "MA Crossover", ... },
    "coaching": "Trade Analysis: AAPL BUY — ✅ Win ($60.00)\n...",
    "analysis": {
      "executionScore": 9,
      "slippage": 0.01,
      "exitReason": "target_hit"
    }
  }
}
```

---

### GET /api/export/trades

Download all trades as CSV.

**Response**: `text/csv` file attachment  
**Filename**: `trades.csv`

---

### GET /api/audit

Retrieve audit log entries.

**Query Parameters**
| Param | Default | Description |
|-------|---------|-------------|
| sessionId | - | Filter by session |
| action | - | Filter by action type |
| limit | 100 | Max entries to return |

---

## WebSocket (Future)

Real-time chat support via WebSocket is architected but pending implementation.
Connect to `ws://localhost:3002/ws` for streaming responses.

---

## Rate Limits

- 100 requests per 15 minutes per IP address
- Exceeding limit returns HTTP 429 with retry-after header
