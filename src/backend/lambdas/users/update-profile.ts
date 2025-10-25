import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { UserRepository } from '../../repositories/UserRepository';
import { UpdateUserRequest, Visibility, SocialLinks } from '../../../shared/types';
import {
  parseRequestBody,
  createErrorResponse,
  createSuccessResponse,
  extractTokenFromHeader,
  isValidEmail,
} from '../auth/utils';
import { verifyJwtToken, TokenVerifierConfig } from '../auth/tokenVerifier';
import { getDatabasePool } from '../../services/database';
import { getAuthEnvironment } from '../auth/config';
import {
  CognitoIdentityProviderClient,
  UpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';

let cognitoClient: CognitoIdentityProviderClient | null = null;
let cognitoRegion: string | null = null;

function getCognitoClient(region: string): CognitoIdentityProviderClient {
  if (!cognitoClient || cognitoRegion !== region) {
    cognitoClient = new CognitoIdentityProviderClient({ region });
    cognitoRegion = region;
  }
  return cognitoClient;
}

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

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function containsUnsafeMarkup(value: string): boolean {
  return /<\s*script/i.test(value) || /on\w+\s*=/.test(value);
}

/**
 * Validate profile update input
 */
function validateProfileInput(input: UpdateUserRequest): { isValid: boolean; errors?: Record<string, string> } {
  const errors: Record<string, string> = {};

  if (input.email !== undefined) {
    const emailValue = input.email.trim();
    if (emailValue.length === 0) {
      errors.email = 'Email cannot be empty';
    } else if (!isValidEmail(emailValue)) {
      errors.email = 'Email must be a valid email address';
    }
  }

  // Validate username if provided
  if (input.username !== undefined) {
    if (input.username.trim() === '') {
      errors.username = 'Username cannot be empty';
    } else if (input.username.length < 3 || input.username.length > 30) {
      errors.username = 'Username must be between 3 and 30 characters';
    } else if (!/^[a-zA-Z0-9_]+$/.test(input.username)) {
      errors.username = 'Username can only contain letters, numbers, and underscores';
    } else if (containsUnsafeMarkup(input.username)) {
      errors.username = 'Username cannot include HTML or script tags';
    }
  }

  // Validate bio if provided
  if (input.bio !== undefined && input.bio !== null) {
    if (input.bio.length > 500) {
      errors.bio = 'Bio cannot exceed 500 characters';
    } else if (containsUnsafeMarkup(input.bio)) {
      errors.bio = 'Bio cannot include HTML or script tags';
    }
  }

  // Validate visibility if provided
  if (input.defaultVisibility !== undefined) {
    const validVisibilities = Object.values(Visibility);
    if (!validVisibilities.includes(input.defaultVisibility)) {
      errors.defaultVisibility = `Visibility must be one of: ${validVisibilities.join(', ')}`;
    }
  }

  // Validate social links if provided
  if (input.socialLinks !== undefined && input.socialLinks !== null) {
    const allowedKeys: Array<keyof SocialLinks> = ['twitter', 'linkedin', 'github', 'website'];
    const links = input.socialLinks;

    allowedKeys.forEach((key) => {
      const value = links?.[key];
      if (value !== undefined && value !== null && value !== '') {
        if (typeof value !== 'string' || !isValidUrl(value)) {
          errors[`socialLinks.${key}`] = 'Must be a valid URL starting with http:// or https://';
        }
      }
    });
  }

  // At least one field must be provided
  const hasAnyField =
    input.email !== undefined ||
    input.username !== undefined ||
    input.bio !== undefined ||
    input.defaultVisibility !== undefined ||
    input.socialLinks !== undefined;

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
    const originHeader = event.headers?.Origin || event.headers?.origin || undefined;
    const corsOptions = { origin: originHeader, methods: 'PATCH,OPTIONS', allowCredentials: true };

    // Extract user ID from path parameters
    const userId = event.pathParameters?.id;
    if (!userId) {
      return createErrorResponse(400, 'VALIDATION_ERROR', 'User ID is required', undefined, corsOptions);
    }

    // Extract and verify access token
    const accessToken = extractTokenFromHeader(event.headers.Authorization);
    if (!accessToken) {
      return createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication token is required', undefined, corsOptions);
    }

    // Verify token and get user
    const dbPool = await getDatabasePool();
    const userRepository = new UserRepository(dbPool);
    const tokenConfig = getTokenVerifierConfig();

    const verificationResult = await verifyJwtToken(accessToken, tokenConfig, userRepository);

    if (!verificationResult.isValid || !verificationResult.user) {
      console.error('Token verification failed:', verificationResult.error);
      return createErrorResponse(401, 'AUTH_INVALID', 'Invalid authentication token', undefined, corsOptions);
    }

    const authenticatedUser = verificationResult.user;

    // Check if authenticated user is updating their own profile
    if (authenticatedUser.id !== userId) {
      return createErrorResponse(403, 'PERMISSION_DENIED', 'You can only update your own profile', undefined, corsOptions);
    }

    // Parse request body
    const { data: requestBody, error: parseError } = parseRequestBody<UpdateUserRequest>(event.body);
    if (parseError) {
      return parseError;
    }

    // Validate input
    const validation = validateProfileInput(requestBody!);
    if (!validation.isValid) {
      return createErrorResponse(400, 'VALIDATION_ERROR', 'Validation failed', { fields: validation.errors }, corsOptions);
    }

    // Update user profile using repository
    const updateData: any = {};
    let normalizedEmail: string | undefined;
    if (requestBody!.email !== undefined) {
      normalizedEmail = requestBody!.email.trim();
      updateData.email = normalizedEmail;
    }
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
    if (requestBody!.socialLinks !== undefined) {
      const sanitizedLinks: SocialLinks = {};
      const incomingLinks = requestBody!.socialLinks || {};
      (['twitter', 'linkedin', 'github', 'website'] as Array<keyof SocialLinks>).forEach((key) => {
        const value = incomingLinks[key];
        if (value !== undefined && value !== null && value !== '') {
          sanitizedLinks[key] = value.trim();
        }
      });
      updateData.socialLinks = sanitizedLinks;
    }

    // If email change requested, sync with Cognito before updating DB
    if (normalizedEmail && normalizedEmail !== authenticatedUser.email) {
      try {
        const authEnv = getAuthEnvironment();
        const client = getCognitoClient(authEnv.region);
        await client.send(
          new UpdateUserAttributesCommand({
            AccessToken: accessToken,
            UserAttributes: [
              { Name: 'email', Value: normalizedEmail },
            ],
          })
        );
      } catch (cognitoError: any) {
        console.error('Cognito email update error:', cognitoError);
        return createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Failed to update email address. Please try again later.',
          undefined,
          corsOptions
        );
      }
    }

    try {
      const updatedUser = await userRepository.updateUser(userId, updateData);

      if (!updatedUser) {
        return createErrorResponse(404, 'NOT_FOUND', 'User not found', undefined, corsOptions);
      }

      console.log('Profile updated successfully for user:', userId);

      return createSuccessResponse(200, {
        message: 'Profile updated successfully',
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          username: updatedUser.username,
          profileSlug: updatedUser.profileSlug,
          bio: updatedUser.bio,
          defaultVisibility: updatedUser.defaultVisibility,
          socialLinks: updatedUser.socialLinks,
          updatedAt: updatedUser.updatedAt,
        },
      }, corsOptions);
    } catch (repoError: any) {
      // Handle validation errors from repository
      if (repoError.validationErrors) {
        return createErrorResponse(409, 'DUPLICATE_RESOURCE', 'Validation failed', {
          fields: repoError.validationErrors,
        }, corsOptions);
      }
      throw repoError;
    }
  } catch (error: any) {
    console.error('Unexpected profile update error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred while updating profile', undefined, {
      origin: event.headers?.Origin || event.headers?.origin || undefined,
      methods: 'PATCH,OPTIONS',
      allowCredentials: true,
    });
  }
}
