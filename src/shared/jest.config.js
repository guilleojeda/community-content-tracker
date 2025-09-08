/** @type {import('jest').Config} */
module.exports = {
  passWithNoTests: true,
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
    'types/**/*.{ts,tsx}',
    '!types/**/*.d.ts',
    '!types/**/*.test.{ts,tsx}',
    '!types/**/__tests__/**',
    '!types/**/node_modules/**',
    '!types/**/dist/**',
    '!types/**/coverage/**'
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