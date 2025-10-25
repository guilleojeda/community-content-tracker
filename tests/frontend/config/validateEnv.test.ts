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

  it('uses localhost default when API URL is missing in non-production environments', () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    process.env = { ...process.env, NODE_ENV: 'development' } as NodeJS.ProcessEnv;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { loadEnv } = require('../../../src/frontend/config/validateEnv');
    const result = loadEnv();

    expect(result.NEXT_PUBLIC_API_URL).toBe('http://localhost:3001/api');
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('throws when API URL is missing during production builds', () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    process.env = { ...process.env, NODE_ENV: 'production' } as NodeJS.ProcessEnv;
    process.env.NEXT_PUBLIC_ENVIRONMENT = 'prod';

    const { loadEnv } = require('../../../src/frontend/config/validateEnv');

    expect(() => loadEnv()).toThrow('NEXT_PUBLIC_API_URL must be set for production builds');
  });

  it('allows localhost fallback for production builds targeting development environment', () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    process.env = { ...process.env, NODE_ENV: 'production' } as NodeJS.ProcessEnv;
    process.env.NEXT_PUBLIC_ENVIRONMENT = 'development';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { loadEnv } = require('../../../src/frontend/config/validateEnv');
    const result = loadEnv();

    expect(result.NEXT_PUBLIC_API_URL).toBe('http://localhost:3001/api');
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
