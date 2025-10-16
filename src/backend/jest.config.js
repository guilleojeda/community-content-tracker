/** @type {import('jest').Config} */
module.exports = {
  passWithNoTests: true,
  preset: 'ts-jest',
  testEnvironment: 'node',
  displayName: 'Backend Tests',
  // Only include backend-specific test suites
  roots: [
    '<rootDir>/src',
    '<rootDir>/../../tests/backend',
    '<rootDir>/../../tests/integration',
    '<rootDir>/../../tests/ci'
  ],
  testMatch: [
    '**/tests/**/*.test.{ts,tsx}',
    '**/__tests__/**/*.{ts,tsx}',
    '**/*.(test|spec).{ts,tsx}'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  },
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.jest.json',
      diagnostics: false
    }
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
  forceExit: true,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/../tests/backend/$1',
    '^@handlers/(.*)$': '<rootDir>/handlers/$1',
    '^@services/(.*)$': '<rootDir>/services/$1',
    '^@models/(.*)$': '<rootDir>/models/$1',
    '^@utils/(.*)$': '<rootDir>/utils/$1',
    '^@config/(.*)$': '<rootDir>/config/$1',
    '^@auth/(.*)$': '<rootDir>/lambdas/auth/$1',
    '^@repo/(.*)$': '<rootDir>/repositories/$1',
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
