const path = require('path');

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  displayName: 'Shared Tests',
  roots: ['<rootDir>/types', '<rootDir>/tests'],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/*.(test|spec).+(ts|tsx|js)'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  },
  collectCoverageFrom: [
    '*.ts',
    'types/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/*.test.{ts,tsx}',
    '!**/__tests__/**',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/coverage/**'
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  setupFilesAfterEnv: [path.resolve(__dirname, '../../tests/setup/consoleMock.js')],
  globalTeardown: path.resolve(__dirname, '../../tests/setup/globalTeardown.js')
};
