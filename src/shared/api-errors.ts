import { APIGatewayProxyResult } from 'aws-lambda';

/**
 * Standard error response format for API Gateway
 * Follows the error format defined in docs/api-errors.md
 */
export function errorResponse(
  code: string,
  message: string,
  statusCode: number,
  details?: Record<string, any>
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      error: {
        code,
        message,
        ...(details && { details }),
      },
    }),
  };
}

/**
 * Success response helper
 */
export function successResponse(
  statusCode: number,
  data: any
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(data),
  };
}
