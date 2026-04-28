'use strict';

/**
 * audit-log.js - Audit trail for all VA chatbot decisions.
 * Records every query, intent, recommendation, and execution.
 * @module utils/audit-log
 */

const { createLogger } = require('./logger');
const Database = require('../database/db');

const logger = createLogger('AuditLog');

class AuditLog {
  /**
   * @param {string} dbPath - Database path
   */
  constructor(dbPath) {
    this.db = new Database(dbPath);
  }

  /**
   * Log an audit event.
   * @param {Object} entry
   * @param {string} entry.action - Action type
   * @param {string} [entry.sessionId] - Session ID
   * @param {string} [entry.intent] - Parsed intent type
   * @param {string} [entry.message] - User message (truncated)
   * @param {string} [entry.symbol] - Stock symbol if applicable
   * @param {number} [entry.latencyMs] - Response latency
   * @param {*} [entry.recommendation] - Recommendation given
   * @param {*} [entry.confidence] - Confidence score
   * @returns {Promise<void>}
   */
  async log(entry) {
    try {
      this.db.saveAuditEntry({
        action: entry.action,
        sessionId: entry.sessionId,
        intent: entry.intent,
        message: entry.message,
        symbol: entry.symbol,
        details: {
          latencyMs: entry.latencyMs,
          confidence: entry.confidence,
          recommendation: entry.recommendation,
          grade: entry.grade,
          winRate: entry.winRate,
          sharpeRatio: entry.sharpeRatio,
          ...entry,
        },
      });
      logger.debug('Audit entry saved', { action: entry.action });
    } catch (error) {
      // Audit failures must not block main flow
      logger.warn('Failed to save audit entry', { error: error.message, action: entry.action });
    }
  }

  /**
   * Retrieve audit log entries.
   * @param {{ sessionId?: string, action?: string, limit?: number }} filters
   * @returns {Object[]}
   */
  query(filters = {}) {
    return this.db.getAuditLog(filters);
  }

  /**
   * Generate a daily risk summary from audit log.
   * @param {string} date - ISO date string (YYYY-MM-DD)
   * @returns {Object}
   */
  dailySummary(date = new Date().toISOString().split('T')[0]) {
    const entries = this.db.getAuditLog({ limit: 1000 });
    const dayEntries = entries.filter(e => e.created_at.startsWith(date));

    const recommendations = dayEntries.filter(e => e.action === 'buy_recommendation');
    const buySignals = recommendations.filter(e => {
      const d = JSON.parse(e.details || '{}');
      return d.recommendation === 'BUY';
    });

    return {
      date,
      totalQueries: dayEntries.length,
      buyRecommendations: buySignals.length,
      totalRecommendations: recommendations.length,
      avgConfidence: buySignals.length
        ? buySignals.reduce((s, e) => {
            const d = JSON.parse(e.details || '{}');
            return s + (d.confidence || 0);
          }, 0) / buySignals.length
        : 0,
    };
  }
}

module.exports = AuditLog;
