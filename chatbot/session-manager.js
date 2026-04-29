'use strict';

/**
 * session-manager.js
 * Manages multi-turn conversation state for the VA chatbot.
 * Stores user context, symbol preferences, risk parameters, etc.
 * Persists sessions to a JSON file; clears sessions older than 24 hours.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createLogger } = require('../utils/logger');

const logger = createLogger('SessionManager');

const SESSION_FILE = path.resolve(__dirname, '../data/sessions.json');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory session store (backed by JSON file)
let _sessions = {};

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

function _ensureDataDir() {
    const dir = path.dirname(SESSION_FILE);
    if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
    }
}

function _load() {
    try {
          _ensureDataDir();
          if (!fs.existsSync(SESSION_FILE)) {
                  _sessions = {};
                  return;
          }
          const raw = fs.readFileSync(SESSION_FILE, 'utf8');
          _sessions = JSON.parse(raw);
    } catch (err) {
          logger.warn(`Could not load sessions file: ${err.message}`);
          _sessions = {};
    }
}

function _save() {
    try {
          _ensureDataDir();
          fs.writeFileSync(SESSION_FILE, JSON.stringify(_sessions, null, 2), 'utf8');
    } catch (err) {
          logger.error(`Could not save sessions file: ${err.message}`);
    }
}

// ---------------------------------------------------------------------------
// Session expiry
// ---------------------------------------------------------------------------

function _purgeExpired() {
    const now = Date.now();
    let purged = 0;
    for (const [id, session] of Object.entries(_sessions)) {
          if (now - session.updatedAt > SESSION_TTL_MS) {
                  delete _sessions[id];
                  purged++;
          }
    }
    if (purged > 0) {
          logger.info(`Purged ${purged} expired session(s)`);
          _save();
    }
}

// Load persisted sessions on module init
_load();
_purgeExpired();

// Run expiry cleanup every hour
setInterval(() => {
    _purgeExpired();
}, 60 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new session for a user.
 * @param {string} [userId] - Optional user ID. Generates one if not provided.
 * @param {Object} [initialContext] - Initial context to store.
 * @returns {Object} The newly created session.
 */
function createSession(userId, initialContext = {}) {
    const id = userId || crypto.randomUUID();
    const now = Date.now();

  const session = {
        id,
        createdAt: now,
        updatedAt: now,
        context: {
                // Default user preferences
          watchlist: ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'META', 'GOOGL'],
                riskParams: {
                          maxDailyLoss: 500,
                          maxPositionSize: 20,
                          maxPositions: 5,
                          defaultStopLoss: 0.05
                },
                lastSymbol: null,
                lastAction: null,
                conversationHistory: [],
                ...initialContext
        }
  };

  _sessions[id] = session;
    _save();
    logger.info(`Session created: ${id}`);
    return session;
}

/**
 * Update an existing session's context.
 * @param {string} sessionId - Session ID to update.
 * @param {Object} updates - Partial context updates to merge.
 * @returns {Object|null} Updated session or null if not found.
 */
function updateSession(sessionId, updates = {}) {
    const session = _sessions[sessionId];
    if (!session) {
          logger.warn(`updateSession: session not found: ${sessionId}`);
          return null;
    }

  session.updatedAt = Date.now();
    session.context = { ...session.context, ...updates };

  // Keep conversation history bounded to last 50 turns
  if (Array.isArray(session.context.conversationHistory) &&
            session.context.conversationHistory.length > 50) {
        session.context.conversationHistory =
                session.context.conversationHistory.slice(-50);
  }

  _save();
    logger.debug(`Session updated: ${sessionId}`);
    return session;
}

/**
 * Retrieve a session by ID.
 * @param {string} sessionId - Session ID to retrieve.
 * @returns {Object|null} The session object or null if not found/expired.
 */
function getSession(sessionId) {
    const session = _sessions[sessionId];
    if (!session) {
          return null;
    }

  // Check if the session has expired
  if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
        delete _sessions[sessionId];
        _save();
        logger.info(`Session expired and removed: ${sessionId}`);
        return null;
  }

  return session;
}

/**
 * Delete a session by ID.
 * @param {string} sessionId - Session ID to delete.
 * @returns {boolean} True if deleted, false if not found.
 */
function deleteSession(sessionId) {
    if (!_sessions[sessionId]) {
          return false;
    }
    delete _sessions[sessionId];
    _save();
    logger.info(`Session deleted: ${sessionId}`);
    return true;
}

/**
 * Get or create a session: returns existing session if valid, else creates one.
 * @param {string} sessionId - Session ID.
 * @param {Object} [initialContext] - Initial context if session needs to be created.
 * @returns {Object} Session object.
 */
function getOrCreateSession(sessionId, initialContext = {}) {
    const existing = getSession(sessionId);
    if (existing) {
          return existing;
    }
    return createSession(sessionId, initialContext);
}

/**
 * Append a message to the conversation history of a session.
 * @param {string} sessionId
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content
 */
function appendMessage(sessionId, role, content) {
    const session = getSession(sessionId);
    if (!session) {
          logger.warn(`appendMessage: session not found: ${sessionId}`);
          return;
    }
    const history = session.context.conversationHistory || [];
    history.push({ role, content, timestamp: Date.now() });
    updateSession(sessionId, { conversationHistory: history });
}

/**
 * Return count of active (non-expired) sessions.
 * @returns {number}
 */
function getActiveSessionCount() {
    _purgeExpired();
    return Object.keys(_sessions).length;
}

module.exports = {
    createSession,
    updateSession,
    getSession,
    deleteSession,
    getOrCreateSession,
    appendMessage,
    getActiveSessionCount
};
