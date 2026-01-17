import { describe, expect, it } from '@jest/globals';
import {
  ApiError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  ConnectionError,
  DatabaseError,
  ExternalApiError,
  formatErrorForLogging,
  InternalError,
  NotFoundError,
  ParsingError,
  RateLimitError,
  ScraperError,
  shouldRetry,
  ThrottlingError,
  TimeoutError,
  toApiError,
  ValidationError,
} from '../errors';

describe('shared error helpers', () => {
  it('serializes ApiError into the standard response shape', () => {
    const error = new ApiError('VALIDATION_ERROR', 'Invalid payload', 400, { field: 'title' }, { retryable: true });

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.statusCode).toBe(400);
    expect(error.details).toEqual({ field: 'title' });
    expect(error.isOperational).toBe(true);
    expect(error.retryable).toBe(true);
    expect(error.isCritical()).toBe(true);
    expect(error.toJSON()).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid payload',
        details: { field: 'title' },
      },
    });
  });

  it('builds common validation and auth errors', () => {
    const validation = new ValidationError('Missing title');
    const auth = new AuthenticationError();
    const forbidden = new AuthorizationError();
    const conflict = new ConflictError('Duplicate');

    expect(validation.code).toBe('VALIDATION_ERROR');
    expect(validation.statusCode).toBe(400);
    expect(auth.code).toBe('AUTH_REQUIRED');
    expect(auth.statusCode).toBe(401);
    expect(forbidden.code).toBe('PERMISSION_DENIED');
    expect(forbidden.statusCode).toBe(403);
    expect(conflict.code).toBe('DUPLICATE_RESOURCE');
    expect(conflict.statusCode).toBe(409);
  });

  it('formats not found errors with or without identifiers', () => {
    const withId = new NotFoundError('Content', 'abc');
    const withoutId = new NotFoundError('User');

    expect(withId.message).toBe('Content not found: abc');
    expect(withId.details).toEqual({ resource: 'Content', identifier: 'abc' });
    expect(withoutId.message).toBe('User not found');
    expect(withoutId.details).toEqual({ resource: 'User', identifier: undefined });
  });

  it('marks rate limit errors as retryable and records reset times', () => {
    const resetAt = new Date('2024-01-01T00:00:00.000Z');
    const error = new RateLimitError('Too many requests', resetAt);

    expect(error.code).toBe('RATE_LIMITED');
    expect(error.statusCode).toBe(429);
    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({ resetAt: resetAt.toISOString() });
  });

  it('marks internal errors as non-operational', () => {
    const error = new InternalError('Unexpected failure');

    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.isOperational).toBe(false);
  });

  it('captures scraper and parsing error metadata', () => {
    const scraper = new ScraperError('github', 'Bad response', { channelId: '1' });
    const parsing = new ParsingError('rss', 'Invalid xml');

    expect(scraper.details).toEqual({ type: 'SCRAPER', scraperType: 'github', channelId: '1' });
    expect(parsing.details).toEqual({ type: 'PARSING', source: 'rss' });
  });

  it('treats external api 429 responses as retryable', () => {
    const rateLimited = new ExternalApiError('cognito', 'Too many', 429);
    const failed = new ExternalApiError('cognito', 'Failed', 500);

    expect(rateLimited.code).toBe('RATE_LIMITED');
    expect(rateLimited.retryable).toBe(true);
    expect(rateLimited.details).toMatchObject({ type: 'EXTERNAL_API', service: 'cognito', statusCode: 429 });

    expect(failed.code).toBe('INTERNAL_ERROR');
    expect(failed.retryable).toBe(false);
    expect(failed.details).toMatchObject({ type: 'EXTERNAL_API', service: 'cognito', statusCode: 500 });
  });

  it('records throttling details with optional reset timestamps', () => {
    const throttling = new ThrottlingError('bedrock');
    const throttlingWithReset = new ThrottlingError('bedrock', new Date('2024-02-02T00:00:00.000Z'));

    expect(throttling.details).toEqual({ type: 'THROTTLING', service: 'bedrock' });
    expect(throttlingWithReset.details).toEqual({
      type: 'THROTTLING',
      service: 'bedrock',
      resetAt: '2024-02-02T00:00:00.000Z',
    });
  });

  it('builds connection and database errors as retryable', () => {
    const connection = new ConnectionError('redis', { host: 'localhost' });
    const database = new DatabaseError('insert', { table: 'content' });

    expect(connection.code).toBe('INTERNAL_ERROR');
    expect(connection.retryable).toBe(true);
    expect(connection.details).toEqual({ type: 'CONNECTION', target: 'redis', host: 'localhost' });
    expect(database.code).toBe('INTERNAL_ERROR');
    expect(database.retryable).toBe(true);
    expect(database.details).toEqual({ type: 'DATABASE', operation: 'insert', table: 'content' });
  });

  it('creates timeout errors and converts unknown errors to ApiError', () => {
    const timeout = new TimeoutError('fetch', 5000);

    expect(timeout.code).toBe('INTERNAL_ERROR');
    expect(timeout.details).toEqual({ type: 'TIMEOUT', operation: 'fetch', timeoutMs: 5000 });
    expect(timeout.retryable).toBe(true);

    const existing = new ValidationError('invalid');
    expect(toApiError(existing)).toBe(existing);

    const connection = toApiError(new Error('ECONNREFUSED: db'));
    expect(connection.details).toMatchObject({ type: 'CONNECTION', target: 'database' });

    const timed = toApiError(new Error('request timeout'));
    expect(timed.details).toMatchObject({ type: 'TIMEOUT', operation: 'operation', timeoutMs: 30000 });

    const generic = toApiError(new Error('unexpected'));
    expect(generic.code).toBe('INTERNAL_ERROR');
    expect(generic.details).toMatchObject({ originalError: 'unexpected' });

    const fromValue = toApiError('raw failure', 'default message');
    expect(fromValue.message).toBe('default message');
  });

  it('identifies retryable failures based on patterns', () => {
    const retryable = new RateLimitError();
    const notRetryable = new ValidationError('invalid');

    expect(shouldRetry(retryable)).toBe(true);
    expect(shouldRetry(notRetryable)).toBe(false);
    expect(shouldRetry(new Error('ECONNREFUSED'))).toBe(true);
    expect(shouldRetry(new Error('ECONNRESET'))).toBe(true);
    expect(shouldRetry(new Error('AWS throttling exception'))).toBe(true);
    expect(shouldRetry(new Error('rate limit reached'))).toBe(true);
    expect(shouldRetry(new Error('bedrock error'))).toBe(true);
    expect(shouldRetry(new Error('57P01 connection terminated'))).toBe(true);
    expect(shouldRetry(new Error('57P03 server shutdown'))).toBe(true);
    expect(shouldRetry(new Error('database unavailable'))).toBe(true);
    expect(shouldRetry(new Error('ResourceNotFound'))).toBe(true);
    expect(shouldRetry(new Error('unknown'))).toBe(false);
  });

  it('formats errors for logging with context', () => {
    const logEntry = formatErrorForLogging(new ValidationError('invalid'), { requestId: 'req-1' });

    expect(logEntry.code).toBe('VALIDATION_ERROR');
    expect(logEntry.message).toBe('invalid');
    expect(logEntry.statusCode).toBe(400);
    expect(logEntry.isOperational).toBe(true);
    expect(logEntry.isCritical).toBe(false);
    expect(logEntry.retryable).toBe(false);
    expect(logEntry.requestId).toBe('req-1');
    expect(typeof logEntry.timestamp).toBe('string');
  });
});
