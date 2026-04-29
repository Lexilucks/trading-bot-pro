'use strict';

/**
 * Central logging utility.
 * Levels: DEBUG, INFO, WARN, ERROR.
 * Output: console plus ./logs/trading.log.
 */

const fs = require('fs');
const path = require('path');

const LEVELS = Object.freeze({ DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 });
const LEVEL_NAMES = Object.freeze(Object.keys(LEVELS));
const LOG_DIR = path.resolve(process.env.LOG_DIR || './logs');
const LOG_FILE = path.join(LOG_DIR, 'trading.log');

let globalLevel = LEVELS[String(process.env.LOG_LEVEL || 'INFO').toUpperCase()] || LEVELS.INFO;

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function safeMeta(meta) {
  if (!meta || typeof meta !== 'object') return '';
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch (_error) {
    return ' {"meta":"[unserializable]"}';
  }
}

function writeLine(line) {
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
  } catch (error) {
    console.error(`[Logger] could not write log file: ${error.message}`);
  }
}

function shouldLog(levelName) {
  return LEVELS[levelName] >= globalLevel;
}

function normalizeLevel(levelName) {
  const upper = String(levelName || 'INFO').toUpperCase();
  return LEVELS[upper] ? upper : 'INFO';
}

function write(namespace, levelName, message, meta) {
  const level = normalizeLevel(levelName);
  if (!shouldLog(level)) return;

  const timestamp = new Date().toISOString();
  const scope = namespace || 'App';
  const text = typeof message === 'string' ? message : JSON.stringify(message);
  const line = `[${timestamp}] [${level}] [${scope}] ${text}${safeMeta(meta)}`;

  if (level === 'ERROR') {
    console.error(line);
  } else if (level === 'WARN') {
    console.warn(line);
  } else {
    console.log(line);
  }

  writeLine(line);
}

function createLogger(namespace = 'App') {
  return {
    debug(message, meta) {
      write(namespace, 'DEBUG', message, meta);
    },
    info(message, meta) {
      write(namespace, 'INFO', message, meta);
    },
    warn(message, meta) {
      write(namespace, 'WARN', message, meta);
    },
    error(message, meta) {
      write(namespace, 'ERROR', message, meta);
    },
    setLevel(levelName) {
      setGlobalLevel(levelName);
    },
  };
}

function setGlobalLevel(levelName) {
  const level = String(levelName || '').toUpperCase();
  if (!LEVELS[level]) {
    throw new Error(`Unknown log level: ${levelName}`);
  }
  globalLevel = LEVELS[level];
}

module.exports = {
  createLogger,
  setGlobalLevel,
  LEVELS,
  LEVEL_NAMES,
  LOG_FILE,
};
