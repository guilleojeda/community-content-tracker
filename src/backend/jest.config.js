/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  displayName: 'Backend Tests',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/*.(test|spec).+(ts|tsx|js)'
  ],
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
    },
    './src/handlers/': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    },
    './src/services/': {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85
    },
    './src/models/': {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95
    }
  },
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup/jest.setup.ts',
    '<rootDir>/tests/setup/db-setup.ts'
  ],
  globalSetup: '<rootDir>/tests/setup/global.setup.ts',
  globalTeardown: '<rootDir>/tests/setup/global.teardown.ts',
  testTimeout: 30000,
  maxWorkers: 1, // Serialize database tests
  verbose: true,
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
    '^@handlers/(.*)$': '<rootDir>/src/handlers/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@models/(.*)$': '<rootDir>/src/models/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1'
  },
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/cdk.out/',
    '/coverage/'
  ],
  slowTestThreshold: 5,
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  setupFiles: ['<rootDir>/tests/setup/env.setup.ts'],
  // Integration test database configuration
  testEnvironmentOptions: {
    NODE_ENV: 'test'
  }
};