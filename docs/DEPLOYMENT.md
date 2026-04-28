# Deployment Guide

## Quick Start (5 minutes)

```bash
# 1. Clone the repo
git clone https://github.com/Lexilucks/trading-bot-pro.git
cd trading-bot-pro

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your settings (account size, API keys, etc.)

# 4. Generate sample data (optional, for testing)
node scripts/generate-sample-data.js

# 5. Start the VA Chatbot server
node chatbot/chatbot-server.js
# → Chatbot API: http://localhost:3002

# 6. (Optional) Start the analytics dashboard separately
node server.js
# → Dashboard: http://localhost:3001
```

---

## Docker Deployment (Recommended for Production)

```bash
# 1. Clone and configure
git clone https://github.com/Lexilucks/trading-bot-pro.git
cd trading-bot-pro
cp .env.example .env

# 2. Edit .env with your production values
nano .env

# 3. Start all services
docker-compose up -d

# 4. Check health
curl http://localhost:3002/api/health
# {"status":"ok","timestamp":"..."}

# 5. View logs
docker-compose logs -f chatbot
```

### Services Started by Docker Compose
| Service | Port | Description |
|---------|------|-------------|
| chatbot | 3002 | VA Chatbot API |
| dashboard | 3001 | Analytics Dashboard |
| trading-bot | 3000 | Trading Bot API |

---

## Running Individual Services

### Chatbot Server Only
```bash
CHATBOT_PORT=3002 \
ACCOUNT_SIZE=100000 \
DB_PATH=./data/trading.db \
node chatbot/chatbot-server.js
```

### Analytics Dashboard Only
```bash
PORT=3001 node server.js
```

---

## Required Node.js Dependencies

Add these to your `package.json`:

```json
{
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.2",
    "express-rate-limit": "^7.4.1",
    "helmet": "^7.2.0",
    "pdfkit": "^0.15.1"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "supertest": "^7.0.0"
  },
  "scripts": {
    "start": "node chatbot/chatbot-server.js",
    "start:dashboard": "node server.js",
    "test": "jest --coverage",
    "test:unit": "jest tests/unit",
    "test:integration": "jest tests/integration",
    "test:e2e": "jest tests/e2e"
  }
}
```

Install:
```bash
npm install better-sqlite3 cors dotenv express express-rate-limit helmet pdfkit
npm install --save-dev jest supertest
```

---

## Environment Variables Reference

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| CHATBOT_PORT | 3002 | No | Chatbot server port |
| PORT | 3001 | No | Dashboard port |
| DB_PATH | ./data/trading.db | No | SQLite database path |
| ACCOUNT_SIZE | 100000 | **Yes** | Your account size in USD |
| MAX_RISK_PER_TRADE | 0.02 | No | Max risk per trade (2%) |
| LOG_LEVEL | INFO | No | DEBUG/INFO/WARN/ERROR |
| SLACK_WEBHOOK_URL | - | No | Slack notifications |
| DISCORD_WEBHOOK_URL | - | No | Discord notifications |
| ALPHA_VANTAGE_API_KEY | - | No | For real market data |

---

## Running Tests

```bash
# Run all tests with coverage
npm test

# Run only unit tests (fast)
npm run test:unit

# Run integration tests
npm run test:integration

# Run E2E tests (requires supertest)
npm run test:e2e

# Coverage report
open coverage/lcov-report/index.html
```

Expected output:
```
Test Suites: 4 passed, 4 total
Tests:       85 passed, 85 total
Coverage:    Statements 92.3%, Branches 87.1%, Functions 94.2%, Lines 92.3%
```

---

## Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Set `ACCOUNT_SIZE` to your actual account value
- [ ] Set `MAX_RISK_PER_TRADE` to your risk tolerance
- [ ] Use a persistent volume for `DB_PATH`
- [ ] Set up Slack/Discord webhook for critical alerts
- [ ] Restrict `CORS_ORIGIN` to your domain
- [ ] Set `LOG_LEVEL=WARN` to reduce log noise
- [ ] Enable HTTPS (reverse proxy with nginx/caddy)
- [ ] Set up daily DB backups
- [ ] Configure process manager (PM2 or Docker restart policy)

---

## Data Persistence

All data is stored in SQLite at `DB_PATH`. To back up:

```bash
# Backup
cp data/trading.db data/trading.db.backup

# Restore
cp data/trading.db.backup data/trading.db
```

The database is created automatically on first run. No migrations needed.

---

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common issues.
