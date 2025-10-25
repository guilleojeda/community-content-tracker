import { afterEach, describe, expect, it } from '@jest/globals';

describe('CORS service', () => {
  const originalEnv = process.env.CORS_ORIGIN;
  const originalCredentials = process.env.CORS_CREDENTIALS;

  afterEach(() => {
    jest.resetModules();
    process.env.CORS_ORIGIN = originalEnv;
    process.env.CORS_CREDENTIALS = originalCredentials;
  });

  const loadCors = async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../../../src/backend/services/cors');
  };

  it('resolves matching origin from configured list', async () => {
    process.env.CORS_ORIGIN = 'http://localhost:3000,https://app.awscommunityhub.org';
    const cors = await loadCors();

    const origin = cors.resolveCorsOrigin('https://app.awscommunityhub.org');

    expect(origin).toBe('https://app.awscommunityhub.org');
  });

  it('falls back to first configured origin when request origin not provided', async () => {
    process.env.CORS_ORIGIN = 'https://app.awscommunityhub.org,https://beta.awscommunityhub.org';
    const cors = await loadCors();

    const origin = cors.resolveCorsOrigin(undefined);

    expect(origin).toBe('https://app.awscommunityhub.org');
  });

  it('returns first configured origin when request origin is not allowed', async () => {
    process.env.CORS_ORIGIN = 'https://app.awscommunityhub.org';
    const cors = await loadCors();

    const origin = cors.resolveCorsOrigin('https://malicious.example.com');

    expect(origin).toBe('https://app.awscommunityhub.org');
  });

  it('builds CORS headers with vary metadata and configured methods', async () => {
    process.env.CORS_ORIGIN = 'https://app.awscommunityhub.org';
    process.env.CORS_CREDENTIALS = 'true';
    const cors = await loadCors();

    const headers = cors.buildCorsHeaders({
      origin: 'https://app.awscommunityhub.org',
      methods: 'GET,POST,OPTIONS',
    });

    expect(headers['Access-Control-Allow-Origin']).toBe('https://app.awscommunityhub.org');
    expect(headers['Access-Control-Allow-Methods']).toBe('GET,POST,OPTIONS');
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(headers.Vary).toBe('Origin');
  });
});
