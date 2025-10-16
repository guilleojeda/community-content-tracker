/** @type {import('jest').Config} */
module.exports = {
  passWithNoTests: false,
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  displayName: 'Frontend Tests',
  roots: ['<rootDir>/../../tests/frontend'],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/?(*.)+(spec|test).+(ts|tsx|js)'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: {
        jsx: 'react-jsx',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true
      }
    }]
  },
  moduleNameMapper: {
    '^@/app/(.*)$': '<rootDir>/app/$1',
    '^@/shared/(.*)$': '<rootDir>/../shared/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@shared/(.*)$': '<rootDir>/../shared/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy'
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    'app/**/*.{ts,tsx}',
    'src/**/*.{ts,tsx}',
    '!app/auth/**',
    '!app/profile/**',
    '!app/HomePageContent.tsx',
    '!**/*.d.ts',
    '!**/*.test.{ts,tsx}',
    '!**/__tests__/**',
    '!**/node_modules/**',
    '!**/.next/**',
    '!**/dist/**',
    '!**/coverage/**'
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
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },
  testTimeout: 10000,
  maxWorkers: '50%',
  forceExit: true
};
