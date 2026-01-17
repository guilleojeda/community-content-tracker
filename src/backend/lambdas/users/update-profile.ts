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
import { getDatabasePool } from '../../services/database';
import { getAuthEnvironment } from '../auth/config';
import { resolveAuthorizerContext } from '../../services/authorizerContext';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';
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
    } else if (input.username.length < 3 || input.username.length > 100) {
      errors.username = 'Username must be between 3 and 100 characters';
    } else if (!/^[a-zA-Z0-9_-]+$/.test(input.username)) {
      errors.username = 'Username can only contain letters, numbers, hyphens, and underscores';
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
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    const originHeader = event.headers?.Origin || event.headers?.origin || undefined;
    const corsOptions = { origin: originHeader, methods: 'PATCH,OPTIONS', allowCredentials: true };
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);
    const respondError = (
      statusCode: number,
      code: string,
      message: string,
      details?: Record<string, unknown>
    ) => withRateLimit(createErrorResponse(statusCode, code, message, details, corsOptions));
    const respondSuccess = (statusCode: number, body: Record<string, unknown>) =>
      withRateLimit(createSuccessResponse(statusCode, body, corsOptions));

    rateLimit = await applyRateLimit(event, { resource: 'users:update-profile' });
    if (rateLimit && !rateLimit.allowed) {
      return respondError(429, 'RATE_LIMITED', 'Too many requests');
    }

    const authContext = resolveAuthorizerContext(event.requestContext?.authorizer as any);
    if (!authContext.userId) {
      return respondError(401, 'AUTH_REQUIRED', 'Authentication required');
    }

    // Extract user ID from path parameters
    const rawUserId = event.pathParameters?.id;
    if (!rawUserId) {
      return respondError(400, 'VALIDATION_ERROR', 'User ID is required');
    }
    const targetUserId = rawUserId === 'me' ? authContext.userId : rawUserId;

    // Check if authenticated user is updating their own profile
    if (authContext.userId !== targetUserId) {
      return respondError(403, 'PERMISSION_DENIED', 'You can only update your own profile');
    }

    // Parse request body
    const { data: requestBody, error: parseError } = parseRequestBody<UpdateUserRequest>(event.body);
    if (parseError) {
      return withRateLimit(parseError);
    }

    // Validate input
    const validation = validateProfileInput(requestBody!);
    if (!validation.isValid) {
      return respondError(400, 'VALIDATION_ERROR', 'Validation failed', { fields: validation.errors });
    }

    // Update user profile using repository
    const updateData: any = {};
    let normalizedEmail: string | undefined;
    if (requestBody!.email !== undefined) {
      normalizedEmail = requestBody!.email.trim();
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
    if (normalizedEmail) {
      const accessToken = extractTokenFromHeader(event.headers.Authorization);
      if (!accessToken) {
        return respondError(401, 'AUTH_REQUIRED', 'Authentication token is required to update email');
      }

      try {
        const dbPool = await getDatabasePool();
        const userRepository = new UserRepository(dbPool);
        const existingUser = await userRepository.findById(targetUserId);
        if (!existingUser) {
          return respondError(404, 'NOT_FOUND', 'User not found');
        }
        if (normalizedEmail === existingUser.email) {
          normalizedEmail = undefined;
        } else {
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
        }
      } catch (cognitoError: any) {
        console.error('Cognito email update error:', cognitoError);
        return respondError(500, 'INTERNAL_ERROR', 'Failed to update email address. Please try again later.');
      }
    }

    try {
      if (normalizedEmail) {
        updateData.email = normalizedEmail;
      }

      const dbPool = await getDatabasePool();
      const userRepository = new UserRepository(dbPool);
      const updatedUser = await userRepository.updateUser(targetUserId, updateData);

      if (!updatedUser) {
        return respondError(404, 'NOT_FOUND', 'User not found');
      }

      console.log('Profile updated successfully for user:', targetUserId);

      return respondSuccess(200, {
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
      });
    } catch (repoError: any) {
      // Handle validation errors from repository
      if (repoError.validationErrors) {
        return respondError(409, 'DUPLICATE_RESOURCE', 'Validation failed', {
          fields: repoError.validationErrors,
        });
      }
      throw repoError;
    }
  } catch (error: any) {
    console.error('Unexpected profile update error:', error);
    return attachRateLimitHeaders(
      createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred while updating profile', undefined, {
        origin: event.headers?.Origin || event.headers?.origin || undefined,
        methods: 'PATCH,OPTIONS',
        allowCredentials: true,
      }),
      rateLimit
    );
  }
}
