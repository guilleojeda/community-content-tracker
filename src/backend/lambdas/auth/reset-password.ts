import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { CognitoIdentityProviderClient, ConfirmForgotPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';
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
 * Validate reset password request
 */
function validateResetPasswordInput(data: {
  email: string;
  confirmationCode: string;
  newPassword: string;
}): { isValid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const { email, confirmationCode, newPassword } = data;

  // Validate email
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    errors.email = 'Email is required';
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      errors.email = 'Invalid email format';
    }
  }

  // Validate confirmation code
  if (!confirmationCode || typeof confirmationCode !== 'string') {
    errors.confirmationCode = 'Confirmation code is required';
  } else if (confirmationCode.length !== 6 || !/^\d{6}$/.test(confirmationCode)) {
    errors.confirmationCode = 'Confirmation code must be 6 digits';
  }

  // Validate new password
  if (!newPassword || typeof newPassword !== 'string') {
    errors.newPassword = 'New password is required';
  } else {
    // Password must be at least 12 characters
    if (newPassword.length < 12) {
      errors.newPassword = 'Password must be at least 12 characters long';
    }

    // Check for required character types
    const hasUppercase = /[A-Z]/.test(newPassword);
    const hasLowercase = /[a-z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    const hasSymbol = /[^A-Za-z0-9]/.test(newPassword);

    if (!hasUppercase || !hasLowercase || !hasNumber || !hasSymbol) {
      errors.newPassword = 'Password must contain uppercase, lowercase, numbers, and symbols';
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Reset Password Lambda handler
 * Confirms password reset with confirmation code and sets new password
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log('Reset password request:', JSON.stringify(event, null, 2));
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    rateLimit = await applyRateLimit(event, { resource: 'auth:reset-password', skipIfAuthorized: true });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(createErrorResponse(429, 'RATE_LIMITED', 'Too many requests'));
    }

    // Parse request body
    const { data: requestBody, error: parseError } = parseRequestBody<{
      email: string;
      confirmationCode: string;
      newPassword: string;
    }>(event.body);

    if (parseError) {
      return withRateLimit(parseError);
    }

    const { email, confirmationCode, newPassword } = requestBody!;

    // Validate input
    const validation = validateResetPasswordInput({ email, confirmationCode, newPassword });
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
        message: 'Password reset successful',
      }));
    }

    // Confirm forgot password with Cognito
    const cognitoClient = getCognitoClient();

    try {
      const authEnv = getAuthEnvironment();
      const confirmPasswordCommand = new ConfirmForgotPasswordCommand({
        ClientId: authEnv.clientId,
        Username: email,
        ConfirmationCode: confirmationCode,
        Password: newPassword,
      });

      await cognitoClient.send(confirmPasswordCommand);

      console.log('Password reset successful for user:', email);

      return withRateLimit(createSuccessResponse(200, {
        message: 'Password reset successful',
      }));

    } catch (cognitoError: any) {
      console.error('Cognito confirm password error:', cognitoError);

      // Handle specific Cognito errors
      if (cognitoError.name === 'CodeMismatchException') {
        return withRateLimit(createErrorResponse(
          400,
          'VALIDATION_ERROR',
          'Invalid confirmation code',
          { field: 'confirmationCode' }
        ));
      }

      if (cognitoError.name === 'ExpiredCodeException') {
        return withRateLimit(createErrorResponse(
          400,
          'VALIDATION_ERROR',
          'Confirmation code has expired. Please request a new code.',
          { field: 'confirmationCode' }
        ));
      }

      if (cognitoError.name === 'InvalidPasswordException') {
        return withRateLimit(createErrorResponse(
          400,
          'VALIDATION_ERROR',
          'Password does not meet requirements',
          { field: 'newPassword' }
        ));
      }

      if (cognitoError.name === 'LimitExceededException') {
        return withRateLimit(createErrorResponse(
          429,
          'RATE_LIMITED',
          'Too many attempts. Please try again later.'
        ));
      }

      // Map other Cognito errors
      return withRateLimit(mapCognitoError(cognitoError));
    }

  } catch (error: any) {
    console.error('Unexpected reset password error:', error);
    return attachRateLimitHeaders(createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred while resetting password'
    ), rateLimit);
  }
}
