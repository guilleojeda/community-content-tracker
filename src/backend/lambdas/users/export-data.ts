import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { UserRepository } from '../../repositories/UserRepository';
import { UserDataExport } from '../../../shared/types';
import {
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
 * Export user data for GDPR compliance Lambda handler
 * GET /users/:id/export
 *
 * Exports ALL user data:
 * - User profile
 * - All content
 * - All badges
 * - All channels
 * - Email preferences
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Export user data request:', JSON.stringify(event, null, 2));

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

    // Check if authenticated user is exporting their own data (or is admin)
    if (authenticatedUser.id !== userId && !authenticatedUser.isAdmin) {
      return createErrorResponse(403, 'PERMISSION_DENIED', 'You can only export your own data');
    }

    // Export user data using repository method
    const exportData = await userRepository.exportUserData(userId);

    if (!exportData) {
      return createErrorResponse(404, 'NOT_FOUND', 'User not found');
    }

    console.log('User data exported successfully for user:', userId);

    // Serialize dates to strings for JSON response
    const serializeUser = (user: any) => ({
      ...user,
      createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : user.createdAt,
      updatedAt: user.updatedAt instanceof Date ? user.updatedAt.toISOString() : user.updatedAt,
    });

    const serializeBadge = (badge: any) => ({
      ...badge,
      awardedAt: badge.awardedAt instanceof Date ? badge.awardedAt.toISOString() : badge.awardedAt,
    });

    // Return complete export data with serialized dates
    const response: UserDataExport = {
      user: serializeUser(exportData.user),
      content: exportData.content || [],
      badges: (exportData.badges || []).map(serializeBadge),
    };

    // Set content disposition for download
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="user-data-${userId}-${new Date().toISOString()}.json"`,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      },
      body: JSON.stringify(response, null, 2),
    };
  } catch (error: any) {
    console.error('Unexpected export data error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred while exporting user data');
  }
}
