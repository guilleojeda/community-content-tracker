import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { CognitoIdentityProviderClient, ResendConfirmationCodeCommand } from '@aws-sdk/client-cognito-identity-provider';
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
 * Validate resend verification request
 */
function validateResendVerificationInput(email: string): { isValid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

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
 * Resend verification Lambda handler
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log('Resend verification request:', JSON.stringify(event, null, 2));
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    rateLimit = await applyRateLimit(event, { resource: 'auth:resend-verification', skipIfAuthorized: true });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(createErrorResponse(429, 'RATE_LIMITED', 'Too many requests'));
    }

    const { data: requestBody, error: parseError } = parseRequestBody<{ email: string }>(event.body);
    if (parseError) {
      return withRateLimit(parseError);
    }

    const { email } = requestBody!;

    const validation = validateResendVerificationInput(email);
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
        message: 'Verification email sent',
      }));
    }

    const cognitoClient = getCognitoClient();

    try {
      const authEnv = getAuthEnvironment();
      const resendCommand = new ResendConfirmationCodeCommand({
        ClientId: authEnv.clientId,
        Username: email,
      });

      await cognitoClient.send(resendCommand);

      return withRateLimit(createSuccessResponse(200, {
        message: 'If an account with that email exists, a verification email has been sent',
      }));
    } catch (cognitoError: any) {
      console.error('Cognito resend verification error:', cognitoError);

      if (
        cognitoError.name === 'UserNotFoundException' ||
        cognitoError.name === 'InvalidParameterException' ||
        (cognitoError.name === 'NotAuthorizedException' && cognitoError.message?.includes('confirmed'))
      ) {
        return withRateLimit(createSuccessResponse(200, {
          message: 'If an account with that email exists, a verification email has been sent',
        }));
      }

      return withRateLimit(mapCognitoError(cognitoError));
    }
  } catch (error: any) {
    console.error('Unexpected resend verification error:', error);
    return attachRateLimitHeaders(createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred while resending verification email'
    ), rateLimit);
  }
}
