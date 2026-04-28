#!/usr/bin/env node
// Generate sample trading log data for testing the analytics dashboard
// Run: node scripts/generate-sample-data.js
// Creates ./trading-logs/sample-trades.json with 90 days of fake trades

const fs = require('fs');
const path = require('path');

const SYMBOLS = ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'SPY', 'QQQ', 'AMD', 'NFLX', 'CRM'];
const SIDES = ['BUY', 'SELL'];
const logsDir = path.join(__dirname, '..', 'trading-logs');

if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const trades = [];
const now = Date.now();
const days = 90;

for (let d = days; d >= 0; d--) {
  const dayTs = now - d * 86400000;
    const numTrades = Math.floor(Math.random() * 8) + 1;
      for (let i = 0; i < numTrades; i++) {
          const symbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
              const side = SIDES[Math.floor(Math.random() * SIDES.length)];
                  const entryPrice = +(100 + Math.random() * 400).toFixed(2);
                      const exitDelta = (Math.random() - 0.42) * 20;
                          const exitPrice = +(entryPrice + exitDelta).toFixed(2);
                              const qty = Math.floor(Math.random() * 50) + 1;
                                  const pnl = +((exitPrice - entryPrice) * qty).toFixed(2);
                                      const executionMs = Math.floor(Math.random() * 600) + 10;
                                          trades.push({
                                                id: `trade-${d}-${i}`,
                                                      symbol, side, qty,
                                                            entryPrice, exitPrice, pnl,
                                                                  executionMs,
                                                                        timestamp: new Date(dayTs + i * 3600000).toISOString(),
                                                                              status: 'closed'
                                                                                  });
                                                                                    }
                                                                                    }

                                                                                    const outFile = path.join(logsDir, 'sample-trades.json');
                                                                                    fs.writeFileSync(outFile, JSON.stringify(trades, null, 2));
                                                                                    console.log(`Generated ${trades.length} sample trades -> ${outFile}`);
                                                                                    console.log('Now run: npm start   (or node server.js) to launch the dashboard');
