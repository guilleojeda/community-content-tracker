import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { Pool } from 'pg';
import { BadgeRepository } from '../../repositories/BadgeRepository';
import { UserRepository } from '../../repositories/UserRepository';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../auth/utils';

let pool: Pool | null = null;

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
 * Get user badges Lambda handler
 * GET /users/:id/badges
 * Public endpoint (no authentication required)
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log('Get user badges request:', JSON.stringify(event, null, 2));

  try {
    // Get user ID from path parameter
    const userId = event.pathParameters?.id;
    if (!userId) {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'User ID is required in path'
      );
    }

    const dbPool = getDbPool();
    const badgeRepository = new BadgeRepository(dbPool);
    const userRepository = new UserRepository(dbPool);

    // Verify user exists
    const user = await userRepository.findById(userId);
    if (!user) {
      return createErrorResponse(
        404,
        'NOT_FOUND',
        'User not found'
      );
    }

    // Get all badges for the user
    const badges = await badgeRepository.findByUserId(userId);

    // Transform badges for response
    const badgesList = badges.map(badge => ({
      id: badge.id,
      badgeType: badge.badgeType,
      awardedAt: badge.awardedAt,
      awardedReason: badge.awardedReason,
    }));

    return createSuccessResponse(200, {
      userId: user.id,
      username: user.username,
      badges: badgesList,
      badgeCount: badgesList.length,
    });

  } catch (error: any) {
    console.error('Unexpected get badges error:', error);
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred'
    );
  }
}