module.exports = {
    projects: [
      '<rootDir>/src/backend',
      '<rootDir>/src/frontend',
      '<rootDir>/src/shared'
    ],
    coverageDirectory: '<rootDir>/coverage',
    collectCoverageFrom: [
      'src/**/*.{ts,tsx}',
      '!src/**/*.d.ts',
      '!src/**/node_modules/**',
      '!src/**/dist/**'
    ]
  };