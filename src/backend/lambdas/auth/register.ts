import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { CognitoIdentityProviderClient, SignUpCommand } from '@aws-sdk/client-cognito-identity-provider';
import { UserRepository } from '../../repositories/UserRepository';
import { RegisterRequest, RegisterResponse, Visibility } from '../../../shared/types';
import {
  validateRegistrationInput,
  parseRequestBody,
  createErrorResponse,
  createSuccessResponse,
  mapCognitoError,
  isAwsEmployee,
  generateProfileSlug,
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
 * Register new user Lambda handler
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log('Register request:', JSON.stringify(event, null, 2));

  try {
    // Parse and validate request body
    const { data: requestBody, error: parseError } = parseRequestBody<RegisterRequest>(event.body);
    if (parseError) {
      return parseError;
    }

    // Validate input
    const validation = validateRegistrationInput(requestBody!);
    if (!validation.isValid) {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Validation failed',
        { fields: validation.errors }
      );
    }

    const { email, password, username } = requestBody!;

    const authEnv = getAuthEnvironment();

    // Initialize database connection
    const dbPool = await getDatabasePool();
    const userRepository = new UserRepository(dbPool);

    // Check for duplicate email/username in database
    try {
      const validationErrors = await userRepository.validateUniqueFields({
        email,
        username,
      });

      if (Object.keys(validationErrors).length > 0) {
        const errorMessage = Object.entries(validationErrors)
          .map(([field, message]) => `${field}: ${message}`)
          .join(', ');

        return createErrorResponse(
          409,
          'DUPLICATE_RESOURCE',
          `User already exists - ${errorMessage}`
        );
      }
    } catch (dbError) {
      console.error('Database validation error:', dbError);
      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Failed to validate user uniqueness'
      );
    }

    // Generate profile slug
    let profileSlug: string;
    try {
      // Get existing slugs to ensure uniqueness
      const existingSlugs = await dbPool.query(
        'SELECT profile_slug FROM users WHERE profile_slug LIKE $1',
        [`${username.toLowerCase()}%`]
      );

      const slugsArray = existingSlugs.rows.map(row => row.profile_slug);
      profileSlug = generateProfileSlug(username, slugsArray);
    } catch (error) {
      console.error('Profile slug generation error:', error);
      // Fallback to simple slug if database query fails
      profileSlug = `${username.toLowerCase()}-${Date.now()}`;
    }

    // Determine if user is AWS employee
    const isAwsEmp = isAwsEmployee(email);

    // Create user in Cognito
    const cognitoClient = getCognitoClient(authEnv.region);
    let cognitoUserSub: string;

    try {
      const signUpCommand = new SignUpCommand({
        ClientId: authEnv.clientId,
        Username: email,
        Password: password,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'custom:username', Value: username },
          { Name: 'custom:is_admin', Value: 'false' },
        ],
      });

      const cognitoResponse = await cognitoClient.send(signUpCommand);
      cognitoUserSub = cognitoResponse.UserSub!;

      console.log('Cognito user created:', cognitoUserSub);
    } catch (cognitoError: any) {
      console.error('Cognito signup error:', cognitoError);
      return mapCognitoError(cognitoError);
    }

    // Create user in database
    let userId: string;
    try {
      const newUser = await userRepository.createUser({
        cognitoSub: cognitoUserSub,
        email,
        username,
        profileSlug,
        defaultVisibility: Visibility.PRIVATE,
        isAdmin: false,
        isAwsEmployee: isAwsEmp,
      });

      userId = newUser.id;
      console.log('Database user created:', userId);
    } catch (dbError: any) {
      console.error('Database user creation error:', dbError);

      // Attempt to clean up Cognito user if database creation fails
      try {
        // Note: In production, you might want to use AdminDeleteUser
        // For now, we'll log the orphaned Cognito user
        console.warn('Orphaned Cognito user created:', cognitoUserSub);
      } catch (cleanupError) {
        console.error('Failed to cleanup Cognito user:', cleanupError);
      }

      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Failed to create user account'
      );
    }

    // Return success response
    const response: RegisterResponse = {
      userId,
      message: 'Please check your email to verify your account',
    };

    console.log('Registration successful:', userId);
    return createSuccessResponse(201, response);

  } catch (error: any) {
    console.error('Unexpected registration error:', error);
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred during registration'
    );
  }
}
