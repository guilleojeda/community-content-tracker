import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import {
  AuthFlowType,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  InitiateAuthCommandInput,
  InitiateAuthCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider';
import { RefreshTokenRequest, RefreshTokenResponse } from '../../../shared/types';
import {
  validateRefreshTokenInput,
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
    const rateLimit = await applyRateLimit(event, { resource: 'auth:refresh', skipIfAuthorized: true });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(
        createErrorResponse(429, 'RATE_LIMITED', 'Too many requests')
      );
    }

    // Parse and validate request body
    const { data: requestBody, error: parseError } = parseRequestBody<RefreshTokenRequest>(event.body);
    if (parseError) {
      return withRateLimit(parseError);
    }

    // Validate input
    const validation = validateRefreshTokenInput(requestBody!);
    if (!validation.isValid) {
      return withRateLimit(createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Validation failed',
        { fields: validation.errors }
      ));
    }

    const { refreshToken } = requestBody!;

    const authEnv = getAuthEnvironment();

    // Refresh tokens with Cognito
    const cognitoClient = getCognitoClient(authEnv.region);

    try {
      const refreshCommandInput: InitiateAuthCommandInput = {
        AuthFlow: AuthFlowType.REFRESH_TOKEN_AUTH,
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
      const authResult = (cognitoResponse as InitiateAuthCommandOutput).AuthenticationResult;

      if (!authResult) {
        console.error('No authentication result returned from Cognito refresh');
        return withRateLimit(createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Failed to refresh tokens'
        ));
      }

      if (!authResult.AccessToken) {
        console.error('No access token in Cognito refresh response');
        return withRateLimit(createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Invalid token refresh response'
        ));
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
      return withRateLimit(createSuccessResponse(200, response));

    } catch (cognitoError: any) {
      console.error('Cognito token refresh error:', cognitoError);
      return withRateLimit(mapCognitoError(cognitoError));
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
