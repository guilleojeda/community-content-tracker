import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { CognitoIdentityProviderClient, ForgotPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';
import {
  parseRequestBody,
  createErrorResponse,
  createSuccessResponse,
  mapCognitoError,
} from './utils';
import { getAuthEnvironment } from './config';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

/**
 * Get Cognito client instance
 */
function getCognitoClient(): CognitoIdentityProviderClient {
  const authEnv = getAuthEnvironment();
  return new CognitoIdentityProviderClient({
    region: authEnv.region,
  });
}

/**
 * Validate forgot password request
 */
function validateForgotPasswordInput(email: string): { isValid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  // Validate email
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    errors.email = 'Email is required';
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      errors.email = 'Invalid email format';
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Forgot Password Lambda handler
 * Initiates password reset flow by sending confirmation code to user's email
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log('Forgot password request:', JSON.stringify(event, null, 2));
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    rateLimit = await applyRateLimit(event, { resource: 'auth:forgot-password', skipIfAuthorized: true });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(createErrorResponse(429, 'RATE_LIMITED', 'Too many requests'));
    }

    // Parse request body
    const { data: requestBody, error: parseError } = parseRequestBody<{ email: string }>(event.body);
    if (parseError) {
      return withRateLimit(parseError);
    }

    const { email } = requestBody!;

    // Validate input
    const validation = validateForgotPasswordInput(email);
    if (!validation.isValid) {
      return withRateLimit(createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Validation failed',
        { fields: validation.errors }
      ));
    }

    if (process.env.LOCAL_AUTH_MODE === 'true') {
      return withRateLimit(createSuccessResponse(200, {
        message: 'If an account with that email exists, a password reset code has been sent',
      }));
    }

    // Initiate forgot password flow with Cognito
    const cognitoClient = getCognitoClient();

    try {
      const authEnv = getAuthEnvironment();
      const forgotPasswordCommand = new ForgotPasswordCommand({
        ClientId: authEnv.clientId,
        Username: email,
      });

      await cognitoClient.send(forgotPasswordCommand);

      console.log('Password reset code sent for user:', email);

      // Return success response (don't reveal if user exists or not for security)
      return createSuccessResponse(200, {
        message: 'If an account with that email exists, a password reset code has been sent',
      });

    } catch (cognitoError: any) {
      console.error('Cognito forgot password error:', cognitoError);

      // For security, don't reveal if user exists or not
      // Return success even if user doesn't exist
      if (cognitoError.name === 'UserNotFoundException' || cognitoError.name === 'InvalidParameterException') {
        return withRateLimit(createSuccessResponse(200, {
          message: 'If an account with that email exists, a password reset code has been sent',
        }));
      }

      // Map other Cognito errors
      return withRateLimit(mapCognitoError(cognitoError));
    }

  } catch (error: any) {
    console.error('Unexpected forgot password error:', error);
    return attachRateLimitHeaders(createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred while processing password reset request'
    ), rateLimit);
  }
}
