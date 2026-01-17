import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

/**
 * Extract user context from API Gateway event
 */
function extractUserContext(event: APIGatewayProxyEvent) {
  const authorizer: any = event.requestContext?.authorizer || {};
  const claims: any = authorizer.claims || {};

  const userId = authorizer.userId || claims.sub || claims['cognito:username'];
  const ipAddress = event.requestContext?.identity?.sourceIp;
  const userAgent = event.headers?.['User-Agent'] || event.headers?.['user-agent'];

  return { userId, ipAddress, userAgent };
}

/**
 * POST /user/consent
 * Grant or revoke consent for a specific type
 */
async function handleManageConsent(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { userId, ipAddress, userAgent } = extractUserContext(event);

  if (!userId) {
    return createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication required');
  }

  const pool = await getDatabasePool();

  try {
    const body = JSON.parse(event.body || '{}');
    const { consentType, granted, consentVersion = '1.0' } = body;

    // Validate consent type
    const validTypes = ['analytics', 'functional', 'marketing'];
    if (!consentType || !validTypes.includes(consentType)) {
      return createErrorResponse(400, 'VALIDATION_ERROR', `Invalid consent type. Must be one of: ${validTypes.join(', ')}`);
    }

    if (typeof granted !== 'boolean') {
      return createErrorResponse(400, 'VALIDATION_ERROR', 'granted must be a boolean');
    }

    // Upsert consent record
    const now = new Date().toISOString();
    const query = `
      INSERT INTO user_consent (user_id, consent_type, granted, granted_at, revoked_at, consent_version, ip_address, user_agent, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (user_id, consent_type)
      DO UPDATE SET
        granted = EXCLUDED.granted,
        granted_at = CASE WHEN EXCLUDED.granted = true THEN EXCLUDED.granted_at ELSE user_consent.granted_at END,
        revoked_at = CASE WHEN EXCLUDED.granted = false THEN EXCLUDED.revoked_at ELSE user_consent.revoked_at END,
        consent_version = EXCLUDED.consent_version,
        ip_address = EXCLUDED.ip_address,
        user_agent = EXCLUDED.user_agent,
        updated_at = EXCLUDED.updated_at
      RETURNING *
    `;

    const values = [
      userId,
      consentType,
      granted,
      granted ? now : null,
      !granted ? now : null,
      consentVersion,
      ipAddress,
      userAgent,
      now
    ];

    const result = await pool.query(query, values);
    const consent = result.rows[0];

    return createSuccessResponse(200, {
      success: true,
      data: {
        consentType: consent.consent_type,
        granted: consent.granted,
        grantedAt: consent.granted_at,
        revokedAt: consent.revoked_at,
        consentVersion: consent.consent_version
      },
      message: granted ? 'Consent granted' : 'Consent revoked'
    });
  } catch (error: any) {
    console.error('Manage consent error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to manage consent');
  }
}

/**
 * GET /user/consent
 * Get user's current consent status for all types
 */
async function handleGetConsent(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { userId } = extractUserContext(event);

  if (!userId) {
    return createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication required');
  }

  const pool = await getDatabasePool();

  try {
    const query = `
      SELECT consent_type, granted, granted_at, revoked_at, consent_version, updated_at
      FROM user_consent
      WHERE user_id = $1
      ORDER BY consent_type
    `;

    const result = await pool.query(query, [userId]);

    // Build consent status object
    const consentStatus: Record<string, any> = {
      analytics: { granted: false, grantedAt: null, revokedAt: null },
      functional: { granted: false, grantedAt: null, revokedAt: null },
      marketing: { granted: false, grantedAt: null, revokedAt: null }
    };

    result.rows.forEach((row: any) => {
      consentStatus[row.consent_type] = {
        granted: row.granted,
        grantedAt: row.granted_at,
        revokedAt: row.revoked_at,
        consentVersion: row.consent_version,
        updatedAt: row.updated_at
      };
    });

    return createSuccessResponse(200, {
      success: true,
      data: consentStatus
    });
  } catch (error: any) {
    console.error('Get consent error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to retrieve consent status');
  }
}

/**
 * POST /user/consent/check
 * Check if user has granted specific consent (for internal use)
 */
async function handleCheckConsent(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { userId } = extractUserContext(event);

  if (!userId) {
    // For anonymous users, no consent is granted
    return createSuccessResponse(200, {
      success: true,
      data: { hasConsent: false, reason: 'anonymous_user' }
    });
  }

  const pool = await getDatabasePool();

  try {
    const body = JSON.parse(event.body || '{}');
    const { consentType = 'analytics' } = body;

    const query = `
      SELECT granted
      FROM user_consent
      WHERE user_id = $1 AND consent_type = $2
    `;

    const result = await pool.query(query, [userId, consentType]);

    const hasConsent = result.rows.length > 0 && result.rows[0].granted === true;

    return createSuccessResponse(200, {
      success: true,
      data: {
        hasConsent,
        consentType,
        reason: hasConsent ? 'consent_granted' : 'consent_not_granted'
      }
    });
  } catch (error: any) {
    console.error('Check consent error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to check consent');
  }
}

/**
 * Main Lambda handler
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  const path = event.path || '';
  const method = (event.httpMethod || 'GET').toUpperCase();
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    rateLimit = await applyRateLimit(event, { resource: 'user:consent' });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(createErrorResponse(429, 'RATE_LIMITED', 'Too many requests'));
    }

    if (method === 'POST' && path === '/user/consent') {
      return withRateLimit(await handleManageConsent(event));
    }

    if (method === 'GET' && path === '/user/consent') {
      return withRateLimit(await handleGetConsent(event));
    }

    if (method === 'POST' && path === '/user/consent/check') {
      return withRateLimit(await handleCheckConsent(event));
    }

    return withRateLimit(createErrorResponse(404, 'NOT_FOUND', `Route not found: ${method} ${path}`));
  } catch (error) {
    console.error('Unhandled consent management error', { path, method, error });
    return attachRateLimitHeaders(
      createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred'),
      rateLimit
    );
  }
}
