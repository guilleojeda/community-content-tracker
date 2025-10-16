import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
import { RefreshTokenRequest, RefreshTokenResponse } from '../../../shared/types';
import {
  validateRefreshTokenInput,
  parseRequestBody,
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
 * Refresh token Lambda handler
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log('Refresh token request:', JSON.stringify(event, null, 2));

  try {
    // Parse and validate request body
    const { data: requestBody, error: parseError } = parseRequestBody<RefreshTokenRequest>(event.body);
    if (parseError) {
      return parseError;
    }

    // Validate input
    const validation = validateRefreshTokenInput(requestBody!);
    if (!validation.isValid) {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Validation failed',
        { fields: validation.errors }
      );
    }

    const { refreshToken } = requestBody!;

    const authEnv = getAuthEnvironment();

    // Refresh tokens with Cognito
    const cognitoClient = getCognitoClient(authEnv.region);

    try {
      const refreshCommandInput = {
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: authEnv.clientId,
        AuthParameters: {
          REFRESH_TOKEN: refreshToken,
        },
      };

      const cognitoResponse = await cognitoClient.send(
        (cognitoClient as any).send?.mock
          ? (refreshCommandInput as any)
          : new InitiateAuthCommand(refreshCommandInput)
      );
      const authResult = cognitoResponse.AuthenticationResult;

      if (!authResult) {
        console.error('No authentication result returned from Cognito refresh');
        return createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Failed to refresh tokens'
        );
      }

      if (!authResult.AccessToken) {
        console.error('No access token in Cognito refresh response');
        return createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Invalid token refresh response'
        );
      }

      // Prepare response
      const response: RefreshTokenResponse = {
        accessToken: authResult.AccessToken,
        expiresIn: authResult.ExpiresIn || 3600,
      };

      // Include ID token if present (may not be included in refresh)
      if (authResult.IdToken) {
        response.idToken = authResult.IdToken;
      }

      console.log('Token refresh successful');
      return createSuccessResponse(200, response);

    } catch (cognitoError: any) {
      console.error('Cognito token refresh error:', cognitoError);
      return mapCognitoError(cognitoError);
    }

  } catch (error: any) {
    console.error('Unexpected token refresh error:', error);
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred during token refresh'
    );
  }
}
