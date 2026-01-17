import type { ApiErrorResponse as SharedApiErrorResponse } from './types';

/**
 * Standardized error handling for AWS Community Content Hub
 *
 * All errors should follow the format defined in docs/api-errors.md:
 * {
 *   error: {
 *     code: "ERROR_CODE",
 *     message: "Human-readable message",
 *     details: {} // Optional additional context
 *   }
 * }
 */

export type ApiErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'DUPLICATE_RESOURCE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface ApiErrorDetails {
  [key: string]: any;
}

export type ApiErrorResponse = SharedApiErrorResponse;

/**
 * Base error class for all application errors
 * Ensures consistent error structure across the application
 */
export class ApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly statusCode: number;
  public readonly details?: ApiErrorDetails;
  public readonly isOperational: boolean;
  public readonly retryable: boolean;

  constructor(
    code: ApiErrorCode,
    message: string,
    statusCode: number = 500,
    details?: ApiErrorDetails,
    options: { isOperational?: boolean; retryable?: boolean } = {}
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = options.isOperational ?? true;
    this.retryable = options.retryable ?? false;

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /**
   * Convert error to API response format
   */
  toJSON(): ApiErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
      },
    };
  }

  /**
   * Check if error is critical (should trigger DLQ retry)
   */
  isCritical(): boolean {
    return this.retryable;
  }
}

/**
 * Predefined error types for common scenarios
 */
export class ValidationError extends ApiError {
  constructor(message: string, details?: ApiErrorDetails) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

export class AuthenticationError extends ApiError {
  constructor(message: string = 'Authentication required') {
    super('AUTH_REQUIRED', message, 401);
  }
}

export class AuthorizationError extends ApiError {
  constructor(message: string = 'Insufficient permissions') {
    super('PERMISSION_DENIED', message, 403);
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} not found: ${identifier}`
      : `${resource} not found`;
    super('NOT_FOUND', message, 404, { resource, identifier });
  }
}

export class ConflictError extends ApiError {
  constructor(message: string, details?: ApiErrorDetails) {
    super('DUPLICATE_RESOURCE', message, 409, details);
  }
}

export class RateLimitError extends ApiError {
  constructor(message: string = 'Too many requests', resetAt?: Date) {
    super(
      'RATE_LIMITED',
      message,
      429,
      resetAt ? { resetAt: resetAt.toISOString() } : undefined,
      { retryable: true }
    );
  }
}

export class InternalError extends ApiError {
  constructor(message: string = 'An unexpected error occurred', details?: ApiErrorDetails) {
    super('INTERNAL_ERROR', message, 500, details, { isOperational: false });
  }
}

/**
 * Scraper-specific errors
 */
export class ScraperError extends ApiError {
  constructor(scraperType: string, message: string, details?: ApiErrorDetails) {
    super('INTERNAL_ERROR', message, 500, { type: 'SCRAPER', scraperType, ...details });
  }
}

export class ParsingError extends ApiError {
  constructor(source: string, message: string, details?: ApiErrorDetails) {
    super('INTERNAL_ERROR', message, 500, { type: 'PARSING', source, ...details });
  }
}

export class ExternalApiError extends ApiError {
  constructor(service: string, message: string, statusCode?: number, details?: ApiErrorDetails) {
    const resolvedStatus = statusCode ?? 500;
    const isRateLimited = resolvedStatus === 429;
    super(
      isRateLimited ? 'RATE_LIMITED' : 'INTERNAL_ERROR',
      message,
      isRateLimited ? 429 : 500,
      { type: 'EXTERNAL_API', service, statusCode: resolvedStatus, ...details },
      { retryable: isRateLimited }
    );
  }
}

export class ThrottlingError extends ApiError {
  constructor(service: string, resetAt?: Date) {
    super(
      'RATE_LIMITED',
      `${service} API rate limit exceeded`,
      429,
      resetAt ? { type: 'THROTTLING', service, resetAt: resetAt.toISOString() } : { type: 'THROTTLING', service },
      { retryable: true }
    );
  }
}

export class ConnectionError extends ApiError {
  constructor(target: string, details?: ApiErrorDetails) {
    super(
      'INTERNAL_ERROR',
      `Failed to connect to ${target}`,
      500,
      { type: 'CONNECTION', target, ...details },
      { retryable: true }
    );
  }
}

export class DatabaseError extends ApiError {
  constructor(operation: string, details?: ApiErrorDetails) {
    super(
      'INTERNAL_ERROR',
      `Database operation failed: ${operation}`,
      500,
      { type: 'DATABASE', operation, ...details },
      { retryable: true }
    );
  }
}

export class TimeoutError extends ApiError {
  constructor(operation: string, timeoutMs: number) {
    super(
      'INTERNAL_ERROR',
      `Operation timed out: ${operation}`,
      500,
      { type: 'TIMEOUT', operation, timeoutMs },
      { retryable: true }
    );
  }
}

/**
 * Utility to convert any error to ApiError
 */
export function toApiError(error: unknown, defaultMessage: string = 'An error occurred'): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof Error) {
    // Check for specific error types
    if (error.message.includes('ECONNREFUSED')) {
      return new ConnectionError('database', { originalError: error.message });
    }
    if (error.message.includes('timeout')) {
      return new TimeoutError('operation', 30000);
    }

    return new InternalError(error.message, { originalError: error.message, stack: error.stack });
  }

  return new InternalError(defaultMessage, { originalError: String(error) });
}

/**
 * Check if an error should trigger DLQ retry in SQS processing
 */
export function shouldRetry(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.isCritical();
  }

  // Check for specific error patterns
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Network and connection errors
    if (message.includes('econnrefused') || message.includes('econnreset')) {
      return true;
    }

    // AWS SDK throttling errors
    if (message.includes('throttling') || message.includes('rate limit')) {
      return true;
    }

    // Bedrock errors
    if (message.includes('bedrock')) {
      return true;
    }

    // Database errors
    if (message.includes('57p01') || message.includes('57p03')) {
      return true;
    }

    if (message.includes('database')) {
      return true;
    }

    // Resource errors
    if (message.includes('resourcenotfound')) {
      return true;
    }
  }

  return false;
}

/**
 * Format error for logging
 */
export function formatErrorForLogging(error: unknown, context?: Record<string, any>): Record<string, any> {
  const apiError = toApiError(error);

  return {
    code: apiError.code,
    message: apiError.message,
    statusCode: apiError.statusCode,
    isOperational: apiError.isOperational,
    isCritical: apiError.isCritical(),
    retryable: apiError.retryable,
    details: apiError.details,
    stack: apiError.stack,
    timestamp: new Date().toISOString(),
    ...context,
  };
}
