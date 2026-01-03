/* eslint-disable global-require */
describe('validateEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('parses required environment variables', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
    process.env.NEXT_PUBLIC_AWS_REGION = 'us-east-1';
    process.env.NEXT_PUBLIC_ENVIRONMENT = 'development';
    process.env.NEXT_PUBLIC_FEEDBACK_URL = 'https://example.com/feedback';
    process.env.NEXT_PUBLIC_ENABLE_BETA_FEATURES = 'false';

    const { loadEnv } = require('../../../src/frontend/config/validateEnv');
    const result = loadEnv();

    expect(result.NEXT_PUBLIC_API_URL).toBe('https://api.example.com');
    expect(result.NEXT_PUBLIC_AWS_REGION).toBe('us-east-1');
    expect(result.NEXT_PUBLIC_ENVIRONMENT).toBe('development');
    expect(result.NEXT_PUBLIC_FEEDBACK_URL).toBe('https://example.com/feedback');
    expect(result.NEXT_PUBLIC_ENABLE_BETA_FEATURES).toBe('false');
  });

  it('throws when API URL is missing', () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    process.env.NEXT_PUBLIC_AWS_REGION = 'us-east-1';
    process.env.NEXT_PUBLIC_ENVIRONMENT = 'development';
    process.env.NEXT_PUBLIC_FEEDBACK_URL = 'https://example.com/feedback';
    process.env.NEXT_PUBLIC_ENABLE_BETA_FEATURES = 'false';

    const { loadEnv } = require('../../../src/frontend/config/validateEnv');

    expect(() => loadEnv()).toThrow('Invalid Next.js environment configuration');
  });
});
