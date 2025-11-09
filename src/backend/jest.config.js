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
    '<rootDir>/../../tests/ci',
    '<rootDir>/../../tests/e2e'
  ],
  testMatch: [
    '**/tests/**/*.test.{ts,tsx}',
    '**/__tests__/**/*.{ts,tsx}',
    '**/*.(test|spec).{ts,tsx}'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.jest.json',
        diagnostics: false,
      },
    ],
  },
  collectCoverageFrom: [
    'lambdas/auth/login.ts',
    'lambdas/auth/register.ts',
    'lambdas/auth/refresh.ts',
    'lambdas/auth/verify-email.ts',
    'lambdas/search/**/*.ts',
    'services/EmbeddingService.ts',
    'services/SearchService.ts',
    'scripts/bootstrap-admin.ts'
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
      functions: 90,
      lines: 90,
      statements: 90
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
    '/coverage/',
    'tests/e2e/ui/',
  ],
  slowTestThreshold: 5,
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  // setupFiles: ['<rootDir>/tests/setup/env.setup.ts'],
  // Integration test database configuration
  testEnvironmentOptions: {
    NODE_ENV: 'test'
  }
};
