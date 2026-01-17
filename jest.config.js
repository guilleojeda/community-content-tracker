/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  projects: [
    '<rootDir>/src/backend',
    '<rootDir>/src/frontend',
    '<rootDir>/src/shared',
    '<rootDir>/src/infrastructure'
  ],
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/*.(test|spec).+(ts|tsx|js)'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  },
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: [
    'text',
    'lcov',
    'html',
    'json'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/e2e/ui/'
  ],
  coverageThreshold: {
    global: {
      lines: 90,
      statements: 90,
      functions: 85,
      branches: 70
    }
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testTimeout: 30000,
  detectOpenHandles: true,
  verbose: true,
  maxWorkers: 1,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
    '^@aws-community-hub/shared$': '<rootDir>/src/shared/types'
  },
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true
};
