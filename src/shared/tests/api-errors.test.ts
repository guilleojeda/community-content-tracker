import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { errorResponse, successResponse } from '../api-errors';
import { resetCorsCache } from '../cors';

describe('shared api responses', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv } as NodeJS.ProcessEnv;
    process.env.CORS_ORIGIN = 'https://app.awscommunityhub.org';
    process.env.CORS_ALLOW_HEADERS = 'Content-Type,Authorization';
    process.env.CORS_ALLOW_METHODS = 'GET,POST,OPTIONS';
    process.env.CORS_MAX_AGE = '600';
    delete process.env.CORS_CREDENTIALS;
    resetCorsCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv } as NodeJS.ProcessEnv;
    resetCorsCache();
  });

  it('builds an error response with details', () => {
    const response = errorResponse('VALIDATION_ERROR', 'Invalid payload', 400, { field: 'title' });

    expect(response.statusCode).toBe(400);
    expect(response.headers).toBeDefined();
    const headers = response.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Access-Control-Allow-Origin']).toBe('https://app.awscommunityhub.org');

    const body = JSON.parse(response.body);
    expect(body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid payload',
        details: { field: 'title' },
      },
    });
  });

  it('omits error details when not provided', () => {
    const response = errorResponse('NOT_FOUND', 'Missing record', 404);

    const body = JSON.parse(response.body);
    expect(body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Missing record',
      },
    });
  });

  it('builds a success response with payload', () => {
    const response = successResponse(201, { ok: true });

    expect(response.statusCode).toBe(201);
    expect(response.headers).toBeDefined();
    const headers = response.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Access-Control-Allow-Origin']).toBe('https://app.awscommunityhub.org');

    const body = JSON.parse(response.body);
    expect(body).toEqual({ ok: true });
  });
});
