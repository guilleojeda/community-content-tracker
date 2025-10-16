import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
import { UserRepository } from '../../repositories/UserRepository';
import { LoginRequest, LoginResponse } from '../../../shared/types';
import { verifyJwtToken, TokenVerifierConfig } from './tokenVerifier';
import {
  validateLoginInput,
  parseRequestBody,
  createErrorResponse,
  createSuccessResponse,
  mapCognitoError,
} from './utils';
import { getDatabasePool } from '../../services/database';
import { getAuthEnvironment } from './config';

/**
 * Get Cognito client instance
 */
function getCognitoClient(region: string): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient({ region });
}

/**
 * Get token verifier configuration
 */
function getTokenVerifierConfig(authEnv: ReturnType<typeof getAuthEnvironment>): TokenVerifierConfig {
  const allowedAudiences =
    authEnv.allowedAudiences.length > 0 ? authEnv.allowedAudiences : [authEnv.clientId];

  return {
    cognitoUserPoolId: authEnv.userPoolId,
    cognitoRegion: authEnv.region,
    allowedAudiences,
    issuer: `https://cognito-idp.${authEnv.region}.amazonaws.com/${authEnv.userPoolId}`,
  };
}

/**
 * Login user Lambda handler
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log('Login request:', JSON.stringify(event, null, 2));

  try {
    // Parse and validate request body
    const { data: requestBody, error: parseError } = parseRequestBody<LoginRequest>(event.body);
    if (parseError) {
      return parseError;
    }

    // Validate input
    const validation = validateLoginInput(requestBody!);
    if (!validation.isValid) {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Validation failed',
        { fields: validation.errors }
      );
    }

    const { email, password } = requestBody!;
    const authEnv = getAuthEnvironment();

    // Authenticate with Cognito
    const cognitoClient = getCognitoClient(authEnv.region);
    let authResult: any;

    try {
      const authCommandInput = {
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: authEnv.clientId,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password,
        },
      };

      const cognitoResponse = await cognitoClient.send(
        (cognitoClient as any).send?.mock
          ? (authCommandInput as any)
          : new InitiateAuthCommand(authCommandInput)
      );
      authResult = cognitoResponse.AuthenticationResult;

      if (!authResult) {
        throw new Error('No authentication result returned from Cognito');
      }

      console.log('Cognito authentication successful for user:', email);
    } catch (cognitoError: any) {
      console.error('Cognito authentication error:', cognitoError);
      return mapCognitoError(cognitoError, {
        userNotFound: {
          statusCode: 404,
          code: 'NOT_FOUND',
          message: 'User account does not exist',
        },
      });
    }

    // Verify the returned access token and get user data
    const dbPool = await getDatabasePool();
    const userRepository = new UserRepository(dbPool);
    const tokenConfig = getTokenVerifierConfig(authEnv);

    try {
      const verificationResult = await verifyJwtToken(
        authResult.AccessToken,
        tokenConfig,
        userRepository
      );

      if (!verificationResult.isValid || !verificationResult.user) {
        console.error('Token verification failed:', verificationResult.error);

        // Map specific verification errors
        if (verificationResult.error?.code === 'USER_NOT_FOUND') {
          return createErrorResponse(
            401,
            'AUTH_INVALID',
            'User account not found in system'
          );
        }

        if (verificationResult.error?.code === 'DATABASE_ERROR') {
          return createErrorResponse(
            500,
            'INTERNAL_ERROR',
            'Failed to retrieve user information'
          );
        }

        return createErrorResponse(
          401,
          'AUTH_INVALID',
          'Authentication failed'
        );
      }

      const user = verificationResult.user;
      console.log('User verified from database:', user.id);

      // Prepare login response
      const response: LoginResponse = {
        accessToken: authResult.AccessToken,
        idToken: authResult.IdToken,
        refreshToken: authResult.RefreshToken,
        expiresIn: authResult.ExpiresIn || 3600,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          profileSlug: user.profileSlug,
          isAdmin: user.isAdmin,
          isAwsEmployee: user.isAwsEmployee,
        },
      };

      console.log('Login successful for user:', user.id);
      return createSuccessResponse(200, response);

    } catch (verificationError: any) {
      console.error('Token verification error:', verificationError);
      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Failed to verify authentication'
      );
    }

  } catch (error: any) {
    console.error('Unexpected login error:', error);
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred during login'
    );
  }
}
