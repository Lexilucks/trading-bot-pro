# VA Chatbot User Guide

## Getting Started

The VA Chatbot is your single point of contact for all trading analysis. Talk to it in plain English — no commands to memorize.

**Base URL**: `http://localhost:3002`  
**Web UI**: `http://localhost:3002`  
**API**: `POST http://localhost:3002/api/chat`

---

## Example Queries

### 📊 Market Analysis

**"Should I buy AAPL?"**
> Runs a micro-backtest, gets optimizer rating, checks scanner signal. Returns BUY/WATCH/AVOID with confidence score, position size, and full reasoning.

**"What's the best stock to trade today?"**
> Scans the market for top setups. Returns top 3 opportunities with confidence scores, risk/reward ratios, entry/target/stop prices.

**"Is TSLA worth trading right now?"**
> Full analysis: backtest + momentum scan + optimizer rating for TSLA.

---

### 📈 Strategy Management

**"Test this strategy: buy at 50-day MA, sell at 20-day MA"**
> Auto-parses the strategy, runs a 2-year backtest, returns: win rate, profit factor, Sharpe ratio, max drawdown, grade (A-F), and suggested tweaks.

**"Test this: buy when RSI below 30, stop loss 2%, take profit 5%"**
> Same pipeline but with RSI oversold strategy parameters.

**"Optimize my MA Crossover strategy"**
> Retrieves your saved strategy, runs parameter optimization, returns improved parameters with expected improvement percentage.

---

### 📉 Performance & Analytics

**"How did yesterday go?"**
> Pulls your trade history for yesterday. Shows P&L, win rate, best/worst trade, Sharpe ratio, max drawdown.

**"Show me my performance this week"**
> Same but for the rolling 7 days.

**"What's my win rate this month?"**
> Calculates win rate from all closed trades this calendar month.

**"Show me all AAPL trades from last week"**
> Lists every AAPL trade in the last 7 days with P&L details. Includes CSV export.

---

### 💰 Position Sizing

**"How many shares of TSLA should I buy?"**
> Uses Kelly Criterion with your TSLA backtest data to calculate recommended position size. Checks against your max risk per trade setting.

**"Calculate position size for MSFT"**
> Same for MSFT. Shows full Kelly vs half Kelly (recommended) vs dollar amount.

---

### 🛡️ Risk Management

**"Give me my daily risk report"**
> Shows: open positions, capital at risk, max possible loss today, daily loss limit, any violations.

**"How much am I at risk right now?"**
> Quick risk summary for current open positions.

---

### 📥 Exports & History

**"Export all trades to CSV"**
> Generates and downloads a complete trade history CSV for tax purposes.

**"Download performance PDF"**
> Exports a PDF report with key metrics and charts.

---

## Strategy Syntax Guide

The chatbot understands these strategy descriptions:

| Strategy Type | Example Phrase |
|---------------|----------------|
| MA Crossover | "buy at 50-day MA, sell at 20-day MA" |
| EMA Crossover | "buy when price crosses 50 EMA" |
| RSI | "buy when RSI below 30" |
| Breakout | "buy on breakout above resistance" |
| Stop/Target | "stop loss at 2%, take profit at 5%" |
| Symbols | Mention tickers: "trade AAPL and TSLA" |

---

## Understanding Recommendations

### Confidence Scores
- **75-100%**: Strong signal — all three systems agree
- **50-74%**: Moderate signal — mixed indicators  
- **Below 50%**: Weak signal — wait for confirmation

### Grade System (A-F)
| Grade | Meaning |
|-------|---------|
| A+ | Exceptional: win rate >60%, profit factor >2.5, Sharpe >2.0, drawdown <5% |
| A  | Excellent: win rate >55%, profit factor >2.0, Sharpe >1.5 |
| B  | Good: win rate >50%, profit factor >1.5, Sharpe >1.0 |
| C  | Average: meets minimum viability |
| D  | Below average: needs improvement |
| F  | Failing: do not trade live |

### Signal Types
- **BUY**: All systems align. Confidence ≥65%. Proceed with recommended position size.
- **WATCH**: Mixed signals. Set alerts and monitor.  
- **AVOID**: Indicators diverge or backtest is poor. Skip this trade.

---

## Position Sizing

The chatbot uses the **Kelly Criterion** for position sizing:

```
Kelly % = (Win Rate × Avg Win/Avg Loss) - (1 - Win Rate)
           ──────────────────────────────────────────────
                         Avg Win / Avg Loss
```

**Always use Half-Kelly** (Kelly ÷ 2) — this is what the chatbot recommends by default. Full Kelly is shown for reference only.

### Risk Limits
- If a position would exceed your `MAX_RISK_PER_TRADE` setting, the chatbot warns you
- Default max risk: 2% of account per trade
- Chatbot will suggest a reduced size if Kelly exceeds your limit

---

## Session Context

The chatbot remembers context within a session:

1. **Symbol context**: Ask "Should I buy it?" after discussing AAPL → chatbot uses AAPL
2. **Period context**: Ask "What about last week?" → uses last week context
3. **Strategy context**: After testing a strategy, "optimize it" → optimizes that strategy

Sessions expire after 30 minutes of inactivity.

---

## Using the API Directly

### Simple Chat
```bash
curl -X POST http://localhost:3002/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Should I buy AAPL?", "sessionId": "my-session"}'
```

### Get Top Picks
```bash
curl http://localhost:3002/api/top-picks
```

### Run Backtest
```bash
curl -X POST http://localhost:3002/api/backtest \
  -H "Content-Type: application/json" \
  -d '{"strategyDescription": "buy at 50-day MA, sell at 20-day MA, stop 2%"}'
```

### Export Trades
```bash
curl http://localhost:3002/api/export/trades -o trades.csv
```

---

## Example Full Session

```
You: "What's moving today?"
Bot: "📡 Today's Top 3 Opportunities:
      1. AAPL - BREAKOUT | Confidence: 87% | R/R: 2.8
      2. NVDA - MOMENTUM | Confidence: 76% | R/R: 2.2  
      ..."

You: "Should I buy AAPL?"  
Bot: "📊 Analysis for AAPL:
      Signal: BUY (82% confidence)
      Win Rate: 61.2% | Profit Factor: 1.87 | Sharpe: 1.31
      Recommended Position: 11 shares ($2,035)"

You: "How many shares should I get?"
Bot: "Based on Kelly Criterion with AAPL data:
      Full Kelly: 22 shares
      Half Kelly (recommended): 11 shares ($2,035)
      ✅ Within your 2% risk parameters."

You: "Test the 50/20 MA strategy on it"
Bot: "🔬 Backtest Results:
      Grade: B | Win Rate: 60.0% | Profit Factor: 1.85
      Sharpe: 1.25 | Max Drawdown: 13.0% | Trades: 145
      Tweaks: Consider adding market regime filter..."

You: "How did I do last month?"
Bot: "📈 Performance (last month):
      Total P&L: $1,890.25 | Win Rate: 65%
      Total Trades: 48 | Sharpe: 1.60..."
```
