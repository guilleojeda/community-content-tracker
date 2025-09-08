/** @type {import('jest').Config} */
module.exports = {
  passWithNoTests: true,
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  displayName: 'Frontend Tests',
  // Sprint 1: No frontend implementation yet, only infrastructure
  roots: [],
  testMatch: [],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/__tests__/**',
    '!src/**/node_modules/**',
    '!src/**/dist/**',
    '!src/**/coverage/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'lcov',
    'html',
    'json-summary'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};