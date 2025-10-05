/** @type {import('jest').Config} */
module.exports = {
  passWithNoTests: true,
  preset: 'ts-jest',
  testEnvironment: 'node',
  displayName: 'Backend Tests',
  // Sprint 2: Authentication Lambda functions implementation
  roots: ['<rootDir>/src', '<rootDir>/../../tests'],
  testMatch: [
    '**/tests/**/*.test.{ts,tsx}',
    '**/__tests__/**/*.{ts,tsx}',
    '**/*.(test|spec).{ts,tsx}'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  },
  collectCoverageFrom: [
    'lambdas/**/*.{ts,tsx}',
    'repositories/**/*.{ts,tsx}',
    'services/**/*.{ts,tsx}',
    'src/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/*.test.{ts,tsx}',
    '!**/__tests__/**',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/coverage/**',
    '!scripts/**'
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
    './lambdas/auth/': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    },
    './repositories/': {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85
    }
  },
  setupFilesAfterEnv: [],
  // globalSetup: '<rootDir>/tests/setup/global.setup.ts',
  // globalTeardown: '<rootDir>/tests/setup/global.teardown.ts',
  testTimeout: 30000,
  maxWorkers: 1, // Serialize database tests
  verbose: true,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
    '^@handlers/(.*)$': '<rootDir>/src/handlers/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@models/(.*)$': '<rootDir>/src/models/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@auth/(.*)$': '<rootDir>/src/backend/lambdas/auth/$1',
    '^@repo/(.*)$': '<rootDir>/src/backend/repositories/$1',
    '^@aws-community-hub/shared$': '<rootDir>/../shared/types'
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
  // setupFiles: ['<rootDir>/tests/setup/env.setup.ts'],
  // Integration test database configuration
  testEnvironmentOptions: {
    NODE_ENV: 'test'
  }
};