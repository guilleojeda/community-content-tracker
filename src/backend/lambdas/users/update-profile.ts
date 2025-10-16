import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { UserRepository } from '../../repositories/UserRepository';
import { UpdateUserRequest, Visibility } from '../../../shared/types';
import {
  parseRequestBody,
  createErrorResponse,
  createSuccessResponse,
  extractTokenFromHeader,
} from '../auth/utils';
import { verifyJwtToken, TokenVerifierConfig } from '../auth/tokenVerifier';
import { getDatabasePool } from '../../services/database';
import { getAuthEnvironment } from '../auth/config';

/**
 * Get token verifier configuration
 */
function getTokenVerifierConfig(): TokenVerifierConfig {
  const authEnv = getAuthEnvironment();
  const allowedAudiences = authEnv.allowedAudiences.length > 0 ? authEnv.allowedAudiences : [authEnv.clientId];

  return {
    cognitoUserPoolId: authEnv.userPoolId,
    cognitoRegion: authEnv.region,
    allowedAudiences,
    issuer: `https://cognito-idp.${authEnv.region}.amazonaws.com/${authEnv.userPoolId}`,
  };
}

/**
 * Validate profile update input
 */
function validateProfileInput(input: UpdateUserRequest): { isValid: boolean; errors?: Record<string, string> } {
  const errors: Record<string, string> = {};

  // Validate username if provided
  if (input.username !== undefined) {
    if (input.username.trim() === '') {
      errors.username = 'Username cannot be empty';
    } else if (input.username.length < 3 || input.username.length > 30) {
      errors.username = 'Username must be between 3 and 30 characters';
    } else if (!/^[a-zA-Z0-9_]+$/.test(input.username)) {
      errors.username = 'Username can only contain letters, numbers, and underscores';
    }
  }

  // Validate bio if provided
  if (input.bio !== undefined && input.bio !== null) {
    if (input.bio.length > 500) {
      errors.bio = 'Bio cannot exceed 500 characters';
    }
  }

  // Validate visibility if provided
  if (input.defaultVisibility !== undefined) {
    const validVisibilities = Object.values(Visibility);
    if (!validVisibilities.includes(input.defaultVisibility)) {
      errors.defaultVisibility = `Visibility must be one of: ${validVisibilities.join(', ')}`;
    }
  }

  // At least one field must be provided
  const hasAnyField =
    input.username !== undefined || input.bio !== undefined || input.defaultVisibility !== undefined;

  if (!hasAnyField) {
    errors.profile = 'At least one field must be provided for update';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  };
}

/**
 * Update user profile Lambda handler
 * PATCH /users/:id
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Update profile request:', JSON.stringify(event, null, 2));

  try {
    // Extract user ID from path parameters
    const userId = event.pathParameters?.id;
    if (!userId) {
      return createErrorResponse(400, 'VALIDATION_ERROR', 'User ID is required');
    }

    // Extract and verify access token
    const accessToken = extractTokenFromHeader(event.headers.Authorization);
    if (!accessToken) {
      return createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication token is required');
    }

    // Verify token and get user
    const dbPool = await getDatabasePool();
    const userRepository = new UserRepository(dbPool);
    const tokenConfig = getTokenVerifierConfig();

    const verificationResult = await verifyJwtToken(accessToken, tokenConfig, userRepository);

    if (!verificationResult.isValid || !verificationResult.user) {
      console.error('Token verification failed:', verificationResult.error);
      return createErrorResponse(401, 'AUTH_INVALID', 'Invalid authentication token');
    }

    const authenticatedUser = verificationResult.user;

    // Check if authenticated user is updating their own profile
    if (authenticatedUser.id !== userId) {
      return createErrorResponse(403, 'PERMISSION_DENIED', 'You can only update your own profile');
    }

    // Parse request body
    const { data: requestBody, error: parseError } = parseRequestBody<UpdateUserRequest>(event.body);
    if (parseError) {
      return parseError;
    }

    // Validate input
    const validation = validateProfileInput(requestBody!);
    if (!validation.isValid) {
      return createErrorResponse(400, 'VALIDATION_ERROR', 'Validation failed', { fields: validation.errors });
    }

    // Update user profile using repository
    const updateData: any = {};
    if (requestBody!.username !== undefined) {
      updateData.username = requestBody!.username;
      // Generate new profile slug from username
      updateData.profileSlug = requestBody!.username.toLowerCase().replace(/[^a-z0-9]/g, '-');
    }
    if (requestBody!.bio !== undefined) {
      updateData.bio = requestBody!.bio;
    }
    if (requestBody!.defaultVisibility !== undefined) {
      updateData.defaultVisibility = requestBody!.defaultVisibility;
    }

    try {
      const updatedUser = await userRepository.updateUser(userId, updateData);

      if (!updatedUser) {
        return createErrorResponse(404, 'NOT_FOUND', 'User not found');
      }

      console.log('Profile updated successfully for user:', userId);

      return createSuccessResponse(200, {
        message: 'Profile updated successfully',
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          profileSlug: updatedUser.profileSlug,
          bio: updatedUser.bio,
          defaultVisibility: updatedUser.defaultVisibility,
          updatedAt: updatedUser.updatedAt,
        },
      });
    } catch (repoError: any) {
      // Handle validation errors from repository
      if (repoError.validationErrors) {
        return createErrorResponse(409, 'DUPLICATE_RESOURCE', 'Validation failed', {
          fields: repoError.validationErrors,
        });
      }
      throw repoError;
    }
  } catch (error: any) {
    console.error('Unexpected profile update error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred while updating profile');
  }
}
