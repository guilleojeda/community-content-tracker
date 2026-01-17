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
    process.env.NEXT_PUBLIC_SITE_URL = 'https://example.com';
    process.env.NEXT_PUBLIC_AWS_REGION = 'us-east-1';
    process.env.NEXT_PUBLIC_ENVIRONMENT = 'development';
    process.env.NEXT_PUBLIC_FEEDBACK_URL = 'https://example.com/feedback';
    process.env.NEXT_PUBLIC_ENABLE_BETA_FEATURES = 'false';

    const { loadEnv } = require('../../../src/frontend/config/validateEnv');
    const result = loadEnv();

    expect(result.NEXT_PUBLIC_API_URL).toBe('https://api.example.com');
    expect(result.NEXT_PUBLIC_SITE_URL).toBe('https://example.com');
    expect(result.NEXT_PUBLIC_AWS_REGION).toBe('us-east-1');
    expect(result.NEXT_PUBLIC_ENVIRONMENT).toBe('development');
    expect(result.NEXT_PUBLIC_FEEDBACK_URL).toBe('https://example.com/feedback');
    expect(result.NEXT_PUBLIC_ENABLE_BETA_FEATURES).toBe('false');
  });

  it('throws when API URL is missing', () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    process.env.NEXT_PUBLIC_SITE_URL = 'https://example.com';
    process.env.NEXT_PUBLIC_AWS_REGION = 'us-east-1';
    process.env.NEXT_PUBLIC_ENVIRONMENT = 'development';
    process.env.NEXT_PUBLIC_FEEDBACK_URL = 'https://example.com/feedback';
    process.env.NEXT_PUBLIC_ENABLE_BETA_FEATURES = 'false';

    const { loadEnv } = require('../../../src/frontend/config/validateEnv');

    expect(() => loadEnv()).toThrow('Invalid Next.js environment configuration');
  });

  it('trims optional verification values and clears empty image CDN URLs', () => {
    process.env.NEXT_PUBLIC_API_URL = ' https://api.example.com ';
    process.env.NEXT_PUBLIC_SITE_URL = ' https://example.com ';
    process.env.NEXT_PUBLIC_AWS_REGION = 'us-east-1';
    process.env.NEXT_PUBLIC_ENVIRONMENT = 'development';
    process.env.NEXT_PUBLIC_FEEDBACK_URL = ' https://example.com/feedback ';
    process.env.NEXT_PUBLIC_ENABLE_BETA_FEATURES = 'true';
    process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION = ' google ';
    process.env.NEXT_PUBLIC_YANDEX_SITE_VERIFICATION = ' yandex ';
    process.env.NEXT_PUBLIC_IMAGE_CDN_URL = '   ';

    const { loadEnv } = require('../../../src/frontend/config/validateEnv');
    const result = loadEnv();

    expect(result.NEXT_PUBLIC_API_URL).toBe('https://api.example.com');
    expect(result.NEXT_PUBLIC_SITE_URL).toBe('https://example.com');
    expect(result.NEXT_PUBLIC_FEEDBACK_URL).toBe('https://example.com/feedback');
    expect(result.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION).toBe('google');
    expect(result.NEXT_PUBLIC_YANDEX_SITE_VERIFICATION).toBe('yandex');
    expect(result.NEXT_PUBLIC_IMAGE_CDN_URL).toBeUndefined();
  });
});
