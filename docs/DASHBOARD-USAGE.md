# Trading Bot Pro Web Dashboard

This dashboard is a standalone private web UI at `public/dashboard.html`. It can run from the Node server, be copied into a website, or be served behind an API proxy.

## What It Includes

- Private session-token gate
- Execute Trades tab for paper trades, backtests, and guarded live trade requests
- Scanner tab for all 40 market-scanner symbols
- Performance tab with 30-day P&L, win rate, best/worst trades, and CSV export
- Strategy Optimizer tab with the last 10 recommendations
- Settings tab for local API key storage, risk limits, watchlist, and alert webhooks
- Mock responses when real APIs or market keys are missing

## Required API Endpoints

The dashboard calls these endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/paper-trading/run` | Run paper trade simulation |
| `POST` | `/api/backtest/custom` | Run custom backtest |
| `GET` | `/api/scanner/momentum` | Fetch scanner momentum data |
| `GET` | `/api/scanner/momentum?stream=1` | Optional SSE scanner stream |
| `GET` | `/api/performance/summary` | Fetch dashboard performance data |
| `POST` | `/api/optimizer/suggestions` | Fetch optimizer recommendations |
| `POST` | `/api/live-trading/execute` | Submit guarded live-trade request |

`server.js` now exposes these endpoints and returns mock data when real trading APIs are not configured.

## Embed On Your Website

1. Copy `public/dashboard.html` to the protected area of your website.
2. Serve it behind your website login, Cloudflare Access, basic auth, or another private gate.
3. If your API is not on `https://lexilucks.com/api`, set a global config before the dashboard script:

```html
<script>
  window.TRADING_API_BASE_URL = 'https://api.your-domain.com/api';
</script>
```

The dashboard default is:

```js
https://lexilucks.com/api
```

## API Proxy Setup

Recommended production flow:

```text
Browser dashboard -> https://lexilucks.com/api/* -> Node server -> trading modules / broker APIs
```

For Nginx:

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:3001/api/;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

For Cloudflare or another host, point `/api/*` to the Node app running this repository.

## Security Notes

- Set `DASHBOARD_SESSION_TOKEN` on the server for a fixed private token.
- All POST requests require `X-Session-Token` and `X-CSRF-Token`.
- API keys are stored in browser `localStorage`.
- API keys are sent only when the configured API base URL uses HTTPS.
- Live broker orders are disabled unless `LIVE_TRADING_ENABLED=true`.
- Do not expose broker API keys in public HTML.
- Do not enable live trading until a broker-specific adapter and approval flow are added.

## Environment Variables

| Variable | Purpose |
|---|---|
| `PORT` | Node server port, default `3001` |
| `DASHBOARD_SESSION_TOKEN` | Optional required dashboard POST token |
| `CORS_ORIGIN` | Allowed browser origin |
| `LOGS_DIR` | Trade and audit log folder |
| `LOG_LEVEL` | `DEBUG`, `INFO`, `WARN`, or `ERROR` |
| `LIVE_TRADING_ENABLED` | Must be `true` before live execution can be attempted |

## Customize Theme

Edit CSS variables at the top of `public/dashboard.html`:

```css
:root {
  --bg: #0d1117;
  --panel: #161b22;
  --blue: #58a6ff;
  --green: #3fb950;
  --yellow: #d29922;
  --red: #f85149;
}
```

## Screenshot Checklist

After opening the dashboard, capture these screens:

- Execute Trades with paper trade result
- Scanner after refresh
- Performance chart
- Strategy Optimizer recommendations
- Settings saved toast

## Test Without API Keys

The UI automatically falls back to mock data:

```json
{"winRate":0.62,"totalPnL":1240,"trades":25}
```

Scanner and optimizer also generate realistic mock rows so the web interface can be tested immediately.

## Deployment

Run:

```bash
./deploy.sh
```

If the script is not executable after a GitHub web download, run:

```bash
chmod +x deploy.sh
./deploy.sh
```
