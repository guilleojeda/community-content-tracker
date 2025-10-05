import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
import { Pool } from 'pg';
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

// Database connection pool
let pool: Pool | null = null;

/**
 * Get database pool instance
 */
function getDbPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
  return pool;
}

/**
 * Get Cognito client instance
 */
function getCognitoClient(): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient({
    region: process.env.COGNITO_REGION || 'us-east-1',
  });
}

/**
 * Get token verifier configuration
 */
function getTokenVerifierConfig(): TokenVerifierConfig {
  return {
    cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID!,
    cognitoRegion: process.env.COGNITO_REGION || 'us-east-1',
    allowedAudiences: [process.env.COGNITO_CLIENT_ID!],
    issuer: `https://cognito-idp.${process.env.COGNITO_REGION || 'us-east-1'}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`,
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

    // Authenticate with Cognito
    const cognitoClient = getCognitoClient();
    let authResult: any;

    try {
      const authCommand = new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: process.env.COGNITO_CLIENT_ID!,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password,
        },
      });

      const cognitoResponse = await cognitoClient.send(authCommand);
      authResult = cognitoResponse.AuthenticationResult;

      if (!authResult) {
        throw new Error('No authentication result returned from Cognito');
      }

      console.log('Cognito authentication successful for user:', email);
    } catch (cognitoError: any) {
      console.error('Cognito authentication error:', cognitoError);
      return mapCognitoError(cognitoError);
    }

    // Verify the returned access token and get user data
    const dbPool = getDbPool();
    const userRepository = new UserRepository(dbPool);
    const tokenConfig = getTokenVerifierConfig();

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