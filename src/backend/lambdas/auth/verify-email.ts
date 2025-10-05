import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { CognitoIdentityProviderClient, ConfirmSignUpCommand } from '@aws-sdk/client-cognito-identity-provider';
import { VerifyEmailRequest, VerifyEmailResponse } from '../../../shared/types';
import {
  validateVerifyEmailInput,
  parseQueryParams,
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
 * Verify email Lambda handler
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log('Verify email request:', JSON.stringify(event, null, 2));

  try {
    // Parse and validate query parameters
    const { email, code, error: parseError } = parseQueryParams(event.queryStringParameters);
    if (parseError) {
      return parseError;
    }

    // Create request object for validation
    const requestData: VerifyEmailRequest = {
      email: email!,
      confirmationCode: code!,
    };

    // Validate input
    const validation = validateVerifyEmailInput(requestData);
    if (!validation.isValid) {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Validation failed',
        { fields: validation.errors }
      );
    }

    // Confirm signup with Cognito
    const cognitoClient = getCognitoClient();

    try {
      const confirmCommand = new ConfirmSignUpCommand({
        ClientId: process.env.COGNITO_CLIENT_ID!,
        Username: email!,
        ConfirmationCode: code!,
      });

      await cognitoClient.send(confirmCommand);

      console.log('Email verification successful for user:', email);

      // Prepare success response
      const response: VerifyEmailResponse = {
        verified: true,
        message: 'Email verified successfully. You can now log in.',
      };

      return createSuccessResponse(200, response);

    } catch (cognitoError: any) {
      console.error('Cognito email verification error:', cognitoError);
      return mapCognitoError(cognitoError);
    }

  } catch (error: any) {
    console.error('Unexpected email verification error:', error);
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred during email verification'
    );
  }
}