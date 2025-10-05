import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { CognitoIdentityProviderClient, ForgotPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';
import {
  parseRequestBody,
  createErrorResponse,
  createSuccessResponse,
  mapCognitoError,
} from './utils';

/**
 * Get Cognito client instance
 */
function getCognitoClient(): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient({
    region: process.env.COGNITO_REGION || 'us-east-1',
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

  try {
    // Parse request body
    const { data: requestBody, error: parseError } = parseRequestBody<{ email: string }>(event.body);
    if (parseError) {
      return parseError;
    }

    const { email } = requestBody!;

    // Validate input
    const validation = validateForgotPasswordInput(email);
    if (!validation.isValid) {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Validation failed',
        { fields: validation.errors }
      );
    }

    // Initiate forgot password flow with Cognito
    const cognitoClient = getCognitoClient();

    try {
      const forgotPasswordCommand = new ForgotPasswordCommand({
        ClientId: process.env.COGNITO_CLIENT_ID!,
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
        return createSuccessResponse(200, {
          message: 'If an account with that email exists, a password reset code has been sent',
        });
      }

      // Map other Cognito errors
      return mapCognitoError(cognitoError);
    }

  } catch (error: any) {
    console.error('Unexpected forgot password error:', error);
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred while processing password reset request'
    );
  }
}
