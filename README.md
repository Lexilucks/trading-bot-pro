# Trading Bot Pro - Analytics Dashboard

A professional analytics dashboard for trading bots. Runs on **port 3001** (separate from the bot on port 3000).

## Features

- **Real-time P&L** - Live trade data from your bot API and log files
- - **Daily P&L Chart** - Bar + cumulative line chart for the last 30 days
  - - **Win/Loss Trend** - Rolling win rate percentage with trend line
    - - **Position Heatmap** - Color-coded stocks showing winners/losers
      - - **Risk Metrics** - Max drawdown, Sharpe ratio estimate
        - - **Execution Speed** - Doughnut chart of trade execution latency buckets
          - - **Recent Trades Table** - Scrollable list of last 50 trades
            - - **CSV Export** - Download all trades for tax purposes
              - - **PDF Report** - Professional performance report with key metrics
               
                - ## Quick Start
               
                - ```bash
                  # 1. Clone the repo
                  git clone https://github.com/Lexilucks/trading-bot-pro.git
                  cd trading-bot-pro

                  # 2. Install dependencies
                  npm install

                  # 3. (Optional) Generate sample data for testing
                  node scripts/generate-sample-data.js

                  # 4. Start the dashboard on port 3001
                  npm start
                  # Open http://localhost:3001
                  ```

                  ## Trade Log Format

                  Place `.json` or `.log` files in `./trading-logs/`. JSON format:

                  ```json
                  {
                    "symbol": "AAPL",
                    "side": "BUY",
                    "qty": 10,
                    "entryPrice": 185.50,
                    "exitPrice": 187.20,
                    "pnl": 17.00,
                    "executionMs": 45,
                    "timestamp": "2026-04-27T10:30:00.000Z",
                    "status": "closed"
                  }
                  ```

                  Array of trade objects or newline-delimited JSON is also supported.

                  ## Environment Variables

                  | Variable | Default | Description |
                  |---|---|---|
                  | `PORT` | `3001` | Dashboard port |
                  | `BOT_API_URL` | `http://localhost:3000` | Trading bot API URL |
                  | `LOGS_DIR` | `./trading-logs` | Path to trade log files |

                  ## API Endpoints

                  | Route | Description |
                  |---|---|
                  | `GET /api/analytics` | Full analytics payload |
                  | `GET /api/trades` | All parsed trades |
                  | `GET /api/positions` | Open positions |
                  | `GET /api/bot/:endpoint` | Proxy to bot API |
                  | `GET /export/csv` | Download trades as CSV |
                  | `GET /export/pdf` | Download performance PDF |

                  ## Tech Stack

                  - **Backend**: Node.js + Express
                  - - **Charts**: Chart.js 4.x (CDN)
                    - - **PDF**: PDFKit
                      - - **No build step required**
                       
                        - ---
                        *Dashboard auto-refreshes every 30 seconds. Bot dashboard runs separately on port 3000.*
