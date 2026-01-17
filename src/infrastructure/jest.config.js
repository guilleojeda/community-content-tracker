const path = require('path');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test', '<rootDir>/../../tests/infrastructure'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'lib/**/*.{ts,tsx}',
    '!lib/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      lines: 90,
      statements: 90
    }
  },
  setupFiles: [path.resolve(__dirname, '../../tests/infrastructure/setup-tests.ts')],
  setupFilesAfterEnv: [path.resolve(__dirname, '../../tests/setup/consoleMock.js')],
  globalTeardown: path.resolve(__dirname, '../../tests/setup/globalTeardown.js'),
  maxWorkers: '50%'
};
