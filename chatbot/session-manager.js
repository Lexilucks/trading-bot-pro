'use strict';

/**
 * Multi-turn session manager for the trading VA chatbot.
 * Persists JSON sessions and removes inactive sessions after 24 hours.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createLogger } = require('../utils/logger');

const logger = createLogger('SessionManager');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function defaultSessionFile() {
  if (process.env.NODE_ENV === 'test') {
    return path.join(os.tmpdir(), `trading-bot-sessions-${process.pid}-${Date.now()}-${Math.random()}.json`);
  }
  return path.resolve(process.env.SESSION_FILE || './data/sessions.json');
}

function now() {
  return Date.now();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class SessionRecord {
  constructor(data, manager) {
    this.id = data.id;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
    this.context = data.context || {};
    this.manager = manager;
  }

  addTurn(turn = {}) {
    const history = Array.isArray(this.context.conversationHistory)
      ? this.context.conversationHistory
      : [];
    history.push({
      ...turn,
      timestamp: turn.timestamp || new Date().toISOString(),
    });
    this.context.conversationHistory = history.slice(-50);
    this.updatedAt = now();
    this.manager.saveSession(this);
    return this;
  }

  get turns() {
    return this.context.conversationHistory || [];
  }

  toJSON() {
    return {
      id: this.id,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      context: this.context,
    };
  }
}

class SessionManager {
  constructor(options = {}) {
    this.sessionFile = path.resolve(options.sessionFile || defaultSessionFile());
    this.ttlMs = options.ttlMs || SESSION_TTL_MS;
    this.sessions = new Map();
    this.load();
    this.clearExpiredSessions();

    if (!options.disableCleanupTimer) {
      this.cleanupTimer = setInterval(() => this.clearExpiredSessions(), 60 * 60 * 1000);
      this.cleanupTimer.unref?.();
    }
  }

  load() {
    try {
      ensureDir(this.sessionFile);
      if (!fs.existsSync(this.sessionFile)) {
        this.sessions.clear();
        return;
      }

      const raw = fs.readFileSync(this.sessionFile, 'utf8');
      if (!raw.trim()) {
        this.sessions.clear();
        return;
      }

      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed) ? parsed : Object.values(parsed);
      this.sessions.clear();
      for (const data of entries) {
        if (data?.id) this.sessions.set(data.id, new SessionRecord(data, this));
      }
    } catch (error) {
      logger.warn('Could not load sessions file', { error: error.message, sessionFile: this.sessionFile });
      this.sessions.clear();
    }
  }

  persist() {
    try {
      ensureDir(this.sessionFile);
      const data = {};
      for (const [id, session] of this.sessions.entries()) {
        data[id] = session.toJSON();
      }
      fs.writeFileSync(this.sessionFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      logger.error('Could not persist sessions', { error: error.message, sessionFile: this.sessionFile });
    }
  }

  defaultContext(initialContext = {}) {
    return {
      watchlist: ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'META', 'GOOGL'],
      riskParams: {
        maxDailyLoss: 500,
        maxPositionSize: 20,
        maxPositions: 5,
        defaultStopLoss: 0.05,
      },
      symbolPreferences: [],
      lastSymbol: null,
      lastStrategy: null,
      lastAction: null,
      conversationHistory: [],
      ...clone(initialContext),
    };
  }

  createSession(userId, initialContext = {}) {
    const id = userId || crypto.randomUUID();
    const stamp = now();
    const session = new SessionRecord({
      id,
      createdAt: stamp,
      updatedAt: stamp,
      context: this.defaultContext(initialContext),
    }, this);

    this.sessions.set(id, session);
    this.persist();
    logger.info('Session created', { sessionId: id });
    return session;
  }

  updateSession(sessionId, updates = {}) {
    const session = this.getSession(sessionId);
    if (!session) {
      logger.warn('Cannot update missing session', { sessionId });
      return null;
    }

    session.context = {
      ...session.context,
      ...clone(updates),
      riskParams: {
        ...(session.context.riskParams || {}),
        ...(updates.riskParams || {}),
      },
    };
    session.updatedAt = now();
    this.saveSession(session);
    return session;
  }

  getSession(sessionId) {
    if (!sessionId) return null;
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (now() - session.updatedAt > this.ttlMs) {
      this.sessions.delete(sessionId);
      this.persist();
      logger.info('Expired session removed', { sessionId });
      return null;
    }

    return session;
  }

  getOrCreate(sessionId = 'default', initialContext = {}) {
    return this.getSession(sessionId) || this.createSession(sessionId, initialContext);
  }

  getOrCreateSession(sessionId = 'default', initialContext = {}) {
    return this.getOrCreate(sessionId, initialContext);
  }

  saveSession(session) {
    const record = session instanceof SessionRecord ? session : new SessionRecord(session, this);
    this.sessions.set(record.id, record);
    this.persist();
    return record;
  }

  appendMessage(sessionId, role, content) {
    const session = this.getOrCreate(sessionId);
    session.addTurn({ role, content });
    return session;
  }

  deleteSession(sessionId) {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) this.persist();
    return deleted;
  }

  clearExpiredSessions() {
    const cutoff = now() - this.ttlMs;
    let count = 0;

    for (const [id, session] of this.sessions.entries()) {
      if (session.updatedAt < cutoff) {
        this.sessions.delete(id);
        count += 1;
      }
    }

    if (count > 0) {
      logger.info('Expired sessions cleared', { count });
      this.persist();
    }

    return count;
  }

  get activeSessionCount() {
    this.clearExpiredSessions();
    return this.sessions.size;
  }
}

const defaultManager = new SessionManager();

function createSession(userId, initialContext = {}) {
  return defaultManager.createSession(userId, initialContext);
}

function updateSession(sessionId, updates = {}) {
  return defaultManager.updateSession(sessionId, updates);
}

function getSession(sessionId) {
  return defaultManager.getSession(sessionId);
}

function getOrCreateSession(sessionId, initialContext = {}) {
  return defaultManager.getOrCreateSession(sessionId, initialContext);
}

function deleteSession(sessionId) {
  return defaultManager.deleteSession(sessionId);
}

function appendMessage(sessionId, role, content) {
  return defaultManager.appendMessage(sessionId, role, content);
}

function getActiveSessionCount() {
  return defaultManager.activeSessionCount;
}

module.exports = SessionManager;
module.exports.SessionRecord = SessionRecord;
module.exports.createSession = createSession;
module.exports.updateSession = updateSession;
module.exports.getSession = getSession;
module.exports.getOrCreateSession = getOrCreateSession;
module.exports.deleteSession = deleteSession;
module.exports.appendMessage = appendMessage;
module.exports.getActiveSessionCount = getActiveSessionCount;
