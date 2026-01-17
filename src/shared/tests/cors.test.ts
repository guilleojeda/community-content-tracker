import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { buildCorsHeaders, resetCorsCache, resolveCorsOrigin } from '../cors';

describe('shared cors helpers', () => {
  const originalEnv = { ...process.env };

  const setBaseEnv = () => {
    process.env.CORS_ORIGIN = 'https://app.awscommunityhub.org,https://beta.awscommunityhub.org';
    process.env.CORS_ALLOW_HEADERS = 'Content-Type,Authorization';
    process.env.CORS_ALLOW_METHODS = 'GET,POST,OPTIONS';
    process.env.CORS_MAX_AGE = '600';
    delete process.env.CORS_CREDENTIALS;
  };

  beforeEach(() => {
    process.env = { ...originalEnv } as NodeJS.ProcessEnv;
    setBaseEnv();
    resetCorsCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv } as NodeJS.ProcessEnv;
    resetCorsCache();
  });

  it('returns matching origin when allowed', () => {
    const origin = resolveCorsOrigin('https://beta.awscommunityhub.org');

    expect(origin).toBe('https://beta.awscommunityhub.org');
  });

  it('returns first allowed origin when request origin is missing', () => {
    const origin = resolveCorsOrigin();

    expect(origin).toBe('https://app.awscommunityhub.org');
  });

  it('returns first allowed origin when request origin is not allowed', () => {
    const origin = resolveCorsOrigin('https://malicious.example.com');

    expect(origin).toBe('https://app.awscommunityhub.org');
  });

  it('builds headers using defaults and enables credentials when set', () => {
    process.env.CORS_CREDENTIALS = 'true';

    const headers = buildCorsHeaders({ origin: 'https://beta.awscommunityhub.org' });

    expect(headers['Access-Control-Allow-Origin']).toBe('https://beta.awscommunityhub.org');
    expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type,Authorization');
    expect(headers['Access-Control-Allow-Methods']).toBe('GET,POST,OPTIONS');
    expect(headers['Access-Control-Max-Age']).toBe('600');
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(headers.Vary).toBe('Origin');
  });

  it('allows overriding headers, methods, max age, and credentials', () => {
    const headers = buildCorsHeaders({
      origin: 'https://beta.awscommunityhub.org',
      allowHeaders: 'Content-Type',
      methods: 'GET',
      maxAgeSeconds: 120,
      allowCredentials: false,
    });

    expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type');
    expect(headers['Access-Control-Allow-Methods']).toBe('GET');
    expect(headers['Access-Control-Max-Age']).toBe('120');
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  it('throws when allowed origins are missing', () => {
    process.env.CORS_ORIGIN = '';
    resetCorsCache();

    expect(() => resolveCorsOrigin('https://app.awscommunityhub.org')).toThrow(
      'CORS_ORIGIN must be set to at least one allowed origin'
    );
  });

  it('throws when required headers are missing', () => {
    delete process.env.CORS_ALLOW_HEADERS;

    expect(() => buildCorsHeaders()).toThrow('CORS_ALLOW_HEADERS must be set');
  });

  it('throws when required methods are missing', () => {
    delete process.env.CORS_ALLOW_METHODS;

    expect(() => buildCorsHeaders()).toThrow('CORS_ALLOW_METHODS must be set');
  });

  it('throws when max age is missing', () => {
    delete process.env.CORS_MAX_AGE;

    expect(() => buildCorsHeaders()).toThrow('CORS_MAX_AGE must be set');
  });

  it('throws when max age is invalid', () => {
    process.env.CORS_MAX_AGE = 'not-a-number';

    expect(() => buildCorsHeaders()).toThrow('CORS_MAX_AGE must be a valid number');
  });

  it('resets cached origins when requested', () => {
    const first = resolveCorsOrigin();
    expect(first).toBe('https://app.awscommunityhub.org');

    process.env.CORS_ORIGIN = 'https://new.awscommunityhub.org';
    const cached = resolveCorsOrigin();
    expect(cached).toBe('https://app.awscommunityhub.org');

    resetCorsCache();
    const updated = resolveCorsOrigin();
    expect(updated).toBe('https://new.awscommunityhub.org');
  });
});
