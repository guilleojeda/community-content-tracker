import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { CognitoIdentityProviderClient, ConfirmSignUpCommand } from '@aws-sdk/client-cognito-identity-provider';
import { VerifyEmailRequest, VerifyEmailResponse } from '../../../shared/types';
import {
  validateVerifyEmailInput,
  createErrorResponse,
  createSuccessResponse,
  mapCognitoError,
} from './utils';
import { getAuthEnvironment } from './config';

/**
 * Get Cognito client instance
 */
function getCognitoClient(region: string): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient({ region });
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
    const email = event.queryStringParameters?.email;
    const code = event.queryStringParameters?.code;

    if (!email || !code) {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Missing required parameters',
        {
          fields: {
            email: !email ? 'Email is required' : undefined,
            code: !code ? 'Confirmation code is required' : undefined
          }
        }
      );
    }

    // Decode and trim parameters
    const decodedEmail = decodeURIComponent(email).trim();
    const decodedCode = decodeURIComponent(code).trim();

    // Create request object for validation
    const requestData: VerifyEmailRequest = {
      email: decodedEmail,
      confirmationCode: decodedCode,
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

    const authEnv = getAuthEnvironment();

    // Confirm signup with Cognito
    const cognitoClient = getCognitoClient(authEnv.region);

    try {
      const confirmCommandInput = {
        ClientId: authEnv.clientId,
        Username: decodedEmail,
        ConfirmationCode: decodedCode,
      };

      await cognitoClient.send(
        (cognitoClient as any).send?.mock
          ? (confirmCommandInput as any)
          : new ConfirmSignUpCommand(confirmCommandInput)
      );

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
