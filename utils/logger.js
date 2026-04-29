'use strict';

/**
 * utils/logger.js
 * Centralized logging utility for the trading bot.
 * Exports createLogger() which returns a named logger instance.
 * Logs to console + rotating file at ./logs/trading.log.
 * Levels: DEBUG, INFO, WARN, ERROR
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const LEVEL_NAMES = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
const LEVEL_COLORS = {
    DEBUG: '\x1b[36m',  // cyan
    INFO:  '\x1b[32m',  // green
    WARN:  '\x1b[33m',  // yellow
    ERROR: '\x1b[31m',  // red
};
const RESET = '\x1b[0m';

const LOG_DIR  = path.resolve(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'trading.log');
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB rotate threshold

let _minLevel = LEVELS[process.env.LOG_LEVEL] !== undefined
  ? LEVELS[process.env.LOG_LEVEL]
    : LEVELS.INFO;

// ---------------------------------------------------------------------------
// File stream
// ---------------------------------------------------------------------------

function _ensureLogDir() {
    if (!fs.existsSync(LOG_DIR)) {
          fs.mkdirSync(LOG_DIR, { recursive: true });
    }
}

function _rotateIfNeeded() {
    try {
          if (fs.existsSync(LOG_FILE)) {
                  const stat = fs.statSync(LOG_FILE);
                  if (stat.size > MAX_FILE_SIZE_BYTES) {
                            const rotated = LOG_FILE.replace('.log', `.${Date.now()}.log`);
                            fs.renameSync(LOG_FILE, rotated);
                  }
          }
    } catch (_) {
          // Non-fatal: continue without rotating
    }
}

let _fileStream = null;

function _getFileStream() {
    if (_fileStream) return _fileStream;
    try {
          _ensureLogDir();
          _rotateIfNeeded();
          _fileStream = fs.createWriteStream(LOG_FILE, { flags: 'a', encoding: 'utf8' });
          _fileStream.on('error', (err) => {
                  // eslint-disable-next-line no-console
                               console.error('[Logger] File stream error:', err.message);
                  _fileStream = null;
          });
    } catch (err) {
          // eslint-disable-next-line no-console
      console.error('[Logger] Cannot open log file:', err.message);
    }
    return _fileStream;
}

// ---------------------------------------------------------------------------
// Core write function
// ---------------------------------------------------------------------------

function _write(namespace, levelName, message, meta) {
    const levelValue = LEVELS[levelName];
    if (levelValue < _minLevel) return;

  const ts = new Date().toISOString();
    const metaStr = meta && Object.keys(meta).length > 0
      ? ' ' + JSON.stringify(meta)
          : '';

  // Console output (colorized)
  const color = LEVEL_COLORS[levelName] || '';
    const consoleMsg = `${color}[${ts}] [${levelName}] [${namespace}]${RESET} ${message}${metaStr}`;
    if (levelName === 'ERROR' || levelName === 'WARN') {
          // eslint-disable-next-line no-console
      console.error(consoleMsg);
    } else {
          // eslint-disable-next-line no-console
      console.log(consoleMsg);
    }

  // File output (plain text)
  const fileMsg = `[${ts}] [${levelName}] [${namespace}] ${message}${metaStr}\n`;
    const stream = _getFileStream();
    if (stream && stream.writable) {
          stream.write(fileMsg);
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a named logger instance.
 * @param {string} namespace - Label shown in every log line, e.g. 'IntegrationLayer'
 * @returns {{ debug, info, warn, error, setLevel }}
 */
function createLogger(namespace) {
    if (!namespace || typeof namespace !== 'string') {
          namespace = 'App';
    }

  return {
        debug(message, meta) { _write(namespace, 'DEBUG', message, meta); },
        info(message, meta)  { _write(namespace, 'INFO',  message, meta); },
        warn(message, meta)  { _write(namespace, 'WARN',  message, meta); },
        error(message, meta) { _write(namespace, 'ERROR', message, meta); },

        /**
               * Override the minimum log level for this process.
         * @param {'DEBUG'|'INFO'|'WARN'|'ERROR'} level
         */
        setLevel(level) {
                if (LEVELS[level] !== undefined) {
                          _minLevel = LEVELS[level];
                }
        }
  };
}

/**
 * Set the global minimum log level.
 * @param {'DEBUG'|'INFO'|'WARN'|'ERROR'} level
 */
function setGlobalLevel(level) {
    if (LEVELS[level] !== undefined) {
          _minLevel = LEVELS[level];
    }
}

module.exports = { createLogger, setGlobalLevel, LEVELS, LEVEL_NAMES };
