'use strict';

/**
 * db.js - SQLite database abstraction layer for the trading bot ecosystem.
 * Handles persistence for trades, backtests, scan alerts, and recommendations.
 * @module database/db
 */

const DatabaseLib = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { createLogger } = require('../utils/logger');

const logger = createLogger('Database');

class TradingDatabase {
  constructor(dbPath = './data/trading.db') {
    this.dbPath = path.resolve(dbPath);
    this.ensureDataDirectory();
    this.db = new DatabaseLib(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
    logger.info('Database initialized', { path: this.dbPath });
  }

  ensureDataDirectory() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL, side TEXT NOT NULL,
        qty REAL NOT NULL, entry_price REAL NOT NULL,
        exit_price REAL, pnl REAL, status TEXT NOT NULL DEFAULT 'open',
        strategy_name TEXT, trade_type TEXT NOT NULL DEFAULT 'paper',
        stop_price REAL, target_price REAL, current_price REAL,
        stop_distance REAL, execution_ms INTEGER, exit_reason TEXT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')), closed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS backtest_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT, strategy_name TEXT,
        win_rate REAL, profit_factor REAL, sharpe_ratio REAL, max_drawdown REAL,
        total_trades INTEGER, total_pnl REAL, avg_win REAL, avg_loss REAL,
        start_date TEXT, end_date TEXT, parameters TEXT, equity_curve TEXT,
        latency_ms INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS scan_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL,
        pattern TEXT, strength REAL, volume_ratio REAL, current_price REAL,
        target_price REAL, stop_price REAL, target_pct REAL, stop_pct REAL,
        confidence REAL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS optimizer_recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT, strategy_name TEXT,
        grade TEXT, score REAL, parameters TEXT, improvement REAL, reasoning TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS strategies (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
        params TEXT NOT NULL, last_backtest TEXT, symbols TEXT, active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT,
        action TEXT NOT NULL, intent TEXT, message TEXT, symbol TEXT,
        details TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades (symbol);
      CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades (timestamp);
      CREATE INDEX IF NOT EXISTS idx_trades_status ON trades (status);
    `);
    logger.debug('Migrations applied');
  }

  saveTrade(trade) {
    return this.db.prepare(`INSERT INTO trades
      (symbol,side,qty,entry_price,exit_price,pnl,status,strategy_name,trade_type,
       stop_price,target_price,current_price,stop_distance,execution_ms,exit_reason,timestamp,closed_at)
      VALUES (@symbol,@side,@qty,@entryPrice,@exitPrice,@pnl,@status,@strategyName,@tradeType,
       @stopPrice,@targetPrice,@currentPrice,@stopDistance,@executionMs,@exitReason,@timestamp,@closedAt)
    `).run({ symbol:trade.symbol,side:trade.side,qty:trade.qty,entryPrice:trade.entryPrice,
      exitPrice:trade.exitPrice??null,pnl:trade.pnl??null,status:trade.status||'open',
      strategyName:trade.strategyName??null,tradeType:trade.tradeType||'paper',
      stopPrice:trade.stopPrice??null,targetPrice:trade.targetPrice??null,
      currentPrice:trade.currentPrice??null,stopDistance:trade.stopDistance??null,
      executionMs:trade.executionMs??null,exitReason:trade.exitReason??null,
      timestamp:trade.timestamp||new Date().toISOString(),closedAt:trade.closedAt??null });
  }

  getTrades({ symbol, status, startDate, endDate, tradeType, limit = 1000 } = {}) {
    let q = 'SELECT * FROM trades WHERE 1=1', p = { limit };
    if (symbol) { q += ' AND symbol=@symbol'; p.symbol = symbol; }
    if (status) { q += ' AND status=@status'; p.status = status; }
    if (tradeType) { q += ' AND trade_type=@tradeType'; p.tradeType = tradeType; }
    if (startDate) { q += ' AND timestamp>=@startDate'; p.startDate = startDate; }
    if (endDate) { q += ' AND timestamp<=@endDate'; p.endDate = endDate + 'T23:59:59.999Z'; }
    q += ' ORDER BY timestamp DESC LIMIT @limit';
    return this.db.prepare(q).all(p).map(r => ({ ...r, entryPrice:r.entry_price,
      exitPrice:r.exit_price, strategyName:r.strategy_name, tradeType:r.trade_type,
      stopPrice:r.stop_price, targetPrice:r.target_price, currentPrice:r.current_price,
      stopDistance:r.stop_distance, executionMs:r.execution_ms, exitReason:r.exit_reason }));
  }

  getTradesByDateRange(s, e) { return this.getTrades({ startDate:s, endDate:e }); }
  getAllTrades() { return this.getTrades(); }

  saveBacktestResult(r) {
    this.db.prepare(`INSERT INTO backtest_results
      (symbol,strategy_name,win_rate,profit_factor,sharpe_ratio,max_drawdown,total_trades,
       total_pnl,avg_win,avg_loss,start_date,end_date,parameters,equity_curve,latency_ms)
      VALUES (@symbol,@strategyName,@winRate,@profitFactor,@sharpeRatio,@maxDrawdown,@totalTrades,
       @totalPnl,@avgWin,@avgLoss,@startDate,@endDate,@parameters,@equityCurve,@latencyMs)
    `).run({ symbol:r.symbol??null,strategyName:r.strategyName??null,winRate:r.winRate??null,
      profitFactor:r.profitFactor??null,sharpeRatio:r.sharpeRatio??null,maxDrawdown:r.maxDrawdown??null,
      totalTrades:r.totalTrades??null,totalPnl:r.totalPnl??null,avgWin:r.avgWin??null,
      avgLoss:r.avgLoss??null,startDate:r.startDate??null,endDate:r.endDate??null,
      parameters:JSON.stringify(r.parameters||r.strategy||{}),
      equityCurve:JSON.stringify(r.equityCurve||[]),latencyMs:r.latencyMs??null });
  }

  getAllBacktestResults() {
    return this.db.prepare('SELECT * FROM backtest_results ORDER BY created_at DESC').all();
  }

  saveScanAlerts(alerts) {
    const ins = this.db.prepare(`INSERT INTO scan_alerts
      (symbol,pattern,strength,volume_ratio,current_price,target_price,stop_price,target_pct,stop_pct,confidence)
      VALUES (@symbol,@pattern,@strength,@volumeRatio,@currentPrice,@targetPrice,@stopPrice,@targetPercent,@stopPercent,@confidence)
    `);
    this.db.transaction(items => { for (const a of items) ins.run(a); })(alerts);
  }

  getAllScanAlerts() {
    return this.db.prepare('SELECT * FROM scan_alerts ORDER BY created_at DESC LIMIT 500').all();
  }

  saveOptimizerRecommendation(rec) {
    this.db.prepare(`INSERT INTO optimizer_recommendations
      (symbol,strategy_name,grade,score,parameters,improvement,reasoning)
      VALUES (@symbol,@strategyName,@grade,@score,@parameters,@improvement,@reasoning)
    `).run({ symbol:rec.symbol??null,strategyName:rec.strategyName??null,grade:rec.grade??null,
      score:rec.score??null,parameters:JSON.stringify(rec.parameters||rec.params||{}),
      improvement:rec.improvementPercent??null,reasoning:rec.reasoning??null });
  }

  getAllOptimizerRecommendations() {
    return this.db.prepare('SELECT * FROM optimizer_recommendations ORDER BY created_at DESC LIMIT 200').all();
  }

  saveStrategy(s) {
    this.db.prepare(`INSERT INTO strategies (name,params,last_backtest,symbols,updated_at)
      VALUES (@name,@params,@lastBacktest,@symbols,datetime('now'))
      ON CONFLICT(name) DO UPDATE SET params=excluded.params,
        last_backtest=excluded.last_backtest,symbols=excluded.symbols,updated_at=excluded.updated_at
    `).run({ name:s.name, params:JSON.stringify(s.params||{}),
      lastBacktest:JSON.stringify(s.lastBacktest||null), symbols:JSON.stringify(s.symbols||[]) });
  }

  getStrategy(name) {
    const r = this.db.prepare('SELECT * FROM strategies WHERE name=?').get(name);
    if (!r) return null;
    return { ...r, params:JSON.parse(r.params||'{}'), lastBacktest:JSON.parse(r.last_backtest||'null'),
      symbols:JSON.parse(r.symbols||'[]') };
  }

  getAllStrategies() {
    return this.db.prepare('SELECT * FROM strategies WHERE active=1').all().map(r =>
      ({ ...r, params:JSON.parse(r.params||'{}'), lastBacktest:JSON.parse(r.last_backtest||'null'),
        symbols:JSON.parse(r.symbols||'[]') }));
  }

  saveAuditEntry(e) {
    this.db.prepare(`INSERT INTO audit_log (session_id,action,intent,message,symbol,details)
      VALUES (@sessionId,@action,@intent,@message,@symbol,@details)
    `).run({ sessionId:e.sessionId??null,action:e.action,intent:e.intent??null,
      message:e.message??null,symbol:e.symbol??null,details:JSON.stringify(e) });
  }

  getAuditLog({ sessionId, action, limit=100 }={}) {
    let q='SELECT * FROM audit_log WHERE 1=1', p={ limit };
    if (sessionId) { q+=' AND session_id=@sessionId'; p.sessionId=sessionId; }
    if (action) { q+=' AND action=@action'; p.action=action; }
    return this.db.prepare(q+' ORDER BY created_at DESC LIMIT @limit').all(p);
  }

  close() { this.db.close(); }
}

module.exports = TradingDatabase;
