'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SessionManager = require('../../chatbot/session-manager');

describe('SessionManager', () => {
  let sessionFile;

  beforeEach(() => {
    sessionFile = path.join(os.tmpdir(), `sessions-${Date.now()}-${Math.random()}.json`);
  });

  afterEach(() => {
    if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
  });

  test('creates, retrieves, and updates a session', () => {
    const manager = new SessionManager({ sessionFile, disableCleanupTimer: true });
    const session = manager.createSession('lexi', { lastSymbol: 'NVDA' });

    expect(session.id).toBe('lexi');
    expect(manager.getSession('lexi').context.lastSymbol).toBe('NVDA');

    manager.updateSession('lexi', { riskParams: { maxDailyLoss: 250 } });
    expect(manager.getSession('lexi').context.riskParams.maxDailyLoss).toBe(250);
  });

  test('stores conversation turns and bounds history', () => {
    const manager = new SessionManager({ sessionFile, disableCleanupTimer: true });
    const session = manager.getOrCreate('default');

    for (let index = 0; index < 55; index += 1) {
      session.addTurn({ role: 'user', content: `message ${index}` });
    }

    expect(manager.getSession('default').context.conversationHistory).toHaveLength(50);
  });

  test('clears sessions older than ttl', () => {
    const manager = new SessionManager({ sessionFile, ttlMs: 1, disableCleanupTimer: true });
    const session = manager.createSession('old');
    session.updatedAt = Date.now() - 1000;
    manager.saveSession(session);

    expect(manager.clearExpiredSessions()).toBe(1);
    expect(manager.getSession('old')).toBeNull();
  });
});
