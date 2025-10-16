import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CognitoIdentityProviderClient, ChangePasswordCommand } from '@aws-sdk/client-cognito-identity-provider';
import { ChangePasswordRequest, ChangePasswordResponse } from '../../../shared/types';
import {
  parseRequestBody,
  createErrorResponse,
  createSuccessResponse,
  mapCognitoError,
  extractTokenFromHeader,
} from '../auth/utils';

// Cognito client instance
let cognitoClient: CognitoIdentityProviderClient | null = null;

/**
 * Get Cognito client instance
 */
function getCognitoClient(): CognitoIdentityProviderClient {
  if (!cognitoClient) {
    cognitoClient = new CognitoIdentityProviderClient({
      region: process.env.COGNITO_REGION || 'us-east-1',
    });
  }
  return cognitoClient;
}

/**
 * Validate password change input
 */
function validatePasswordChangeInput(input: ChangePasswordRequest): { isValid: boolean; errors?: Record<string, string> } {
  const errors: Record<string, string> = {};

  if (!input.currentPassword) {
    errors.currentPassword = 'Current password is required';
  }

  if (!input.newPassword) {
    errors.newPassword = 'New password is required';
  } else if (input.newPassword.length < 12) {
    errors.newPassword = 'Password must be at least 12 characters';
  } else {
    // Check password strength
    const hasUpperCase = /[A-Z]/.test(input.newPassword);
    const hasLowerCase = /[a-z]/.test(input.newPassword);
    const hasNumbers = /\d/.test(input.newPassword);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(input.newPassword);

    if (!hasUpperCase || !hasLowerCase || !hasNumbers || !hasSpecialChar) {
      errors.newPassword = 'Password must contain uppercase, lowercase, number, and special character';
    }
  }

  if (input.currentPassword === input.newPassword) {
    errors.newPassword = 'New password must be different from current password';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  };
}

/**
 * Change user password Lambda handler
 * POST /users/:id/password
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Change password request:', JSON.stringify(event, null, 2));

  try {
    // Extract user ID from path parameters
    const userId = event.pathParameters?.id;
    if (!userId) {
      return createErrorResponse(400, 'VALIDATION_ERROR', 'User ID is required');
    }

    // Extract access token from Authorization header
    const accessToken = extractTokenFromHeader(event.headers.Authorization);
    if (!accessToken) {
      return createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication token is required');
    }

    // Parse request body
    const { data: requestBody, error: parseError } = parseRequestBody<ChangePasswordRequest>(event.body);
    if (parseError) {
      return parseError;
    }

    // Validate input
    const validation = validatePasswordChangeInput(requestBody!);
    if (!validation.isValid) {
      return createErrorResponse(400, 'VALIDATION_ERROR', 'Validation failed', { fields: validation.errors });
    }

    const { currentPassword, newPassword } = requestBody!;

    // Change password in Cognito
    const cognito = getCognitoClient();

    try {
      await cognito.send(
        new ChangePasswordCommand({
          PreviousPassword: currentPassword,
          ProposedPassword: newPassword,
          AccessToken: accessToken,
        })
      );

      console.log('Password changed successfully for user:', userId);

      const response: ChangePasswordResponse = {
        message: 'Password changed successfully',
      };

      return createSuccessResponse(200, response);
    } catch (cognitoError: any) {
      console.error('Cognito password change error:', cognitoError);
      return mapCognitoError(cognitoError);
    }
  } catch (error: any) {
    console.error('Unexpected password change error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred while changing password');
  }
}
