'use strict';

/**
 * jest.config.js
 * Jest test configuration for the trading bot ecosystem.
 * Targets >90% coverage across all modules.
 */

module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: [
    '<rootDir>/tests/unit/**/*.test.js',
    '<rootDir>/tests/integration/**/*.test.js',
    '<rootDir>/tests/e2e/**/*.test.js',
  ],
  collectCoverageFrom: [
    'chatbot/**/*.js',
    'database/**/*.js',
    'utils/**/*.js',
    '!**/*.test.js',
    '!**/node_modules/**',
  ],
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
  coverageReporters: ['text', 'lcov', 'html'],
  coverageDirectory: './coverage',
  verbose: true,
  testTimeout: 10000,
  clearMocks: true,
  resetMocks: false,
  restoreMocks: false,
  testPathIgnorePatterns: ['/node_modules/'],
  moduleNameMapper: {
    // Prevent SQLite from loading in test environment unless explicitly needed
  },
  setupFilesAfterFramework: [],
  globals: {
    'NODE_ENV': 'test',
  },
};
