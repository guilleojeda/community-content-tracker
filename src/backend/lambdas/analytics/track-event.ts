import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';
import { anonymizeIp } from '../../utils/ip-anonymization';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

const VALID_EVENT_TYPES = [
  'page_view',
  'search',
  'content_view',
  'content_click',
  'profile_view',
  'export',
  'login',
  'registration',
];

interface TrackEventRequest {
  eventType: string;
  contentId?: string;
  metadata?: Record<string, any>;
  sessionId?: string;
}

interface BatchTrackEventRequest {
  events: TrackEventRequest[];
}

/**
 * POST /analytics/track
 * Track analytics event (GDPR compliant)
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  try {
    const rateLimit = await applyRateLimit(event, { resource: 'analytics:track', skipIfAuthorized: true });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(createErrorResponse(429, 'RATE_LIMITED', 'Too many requests'));
    }

    const rawBody = JSON.parse(event.body || '{}') as TrackEventRequest | TrackEventRequest[] | BatchTrackEventRequest;

    // Normalize to array of events
    const normalizeEvents = (input: typeof rawBody): TrackEventRequest[] => {
      if (Array.isArray(input)) {
        return input;
      }

      if ((input as BatchTrackEventRequest)?.events && Array.isArray((input as BatchTrackEventRequest).events)) {
        return (input as BatchTrackEventRequest).events;
      }

      return [input as TrackEventRequest];
    };

    const events = normalizeEvents(rawBody);

    if (!events.length) {
      return withRateLimit(createErrorResponse(400, 'VALIDATION_ERROR', 'At least one analytics event is required'));
    }

    // Validate event type
    const invalidEvent = events.find(
      evt => !evt.eventType || !VALID_EVENT_TYPES.includes(evt.eventType)
    );

    if (invalidEvent) {
      return withRateLimit(createErrorResponse(
        400,
        'VALIDATION_ERROR',
        `Invalid event type. Must be one of: ${VALID_EVENT_TYPES.join(', ')}`
      ));
    }

    const pool = await getDatabasePool();

    // Extract user ID from authorizer (if authenticated)
    const authorizer: any = event.requestContext?.authorizer || {};
    const userId = authorizer.userId || authorizer.claims?.sub || null;

    // GDPR Compliance: Check analytics consent for authenticated users
    if (userId) {
      const consentQuery = `
        SELECT granted
        FROM user_consent
        WHERE user_id = $1 AND consent_type = 'analytics'
      `;
      const consentResult = await pool.query(consentQuery, [userId]);

      // If no consent record exists or consent is not granted, do not track
      const hasConsent = consentResult.rows.length > 0 && consentResult.rows[0].granted === true;

      if (!hasConsent) {
        return withRateLimit(createSuccessResponse(200, {
          success: true,
          data: {
            tracked: false,
            reason: 'consent_not_granted',
            message: 'Analytics tracking requires user consent'
          },
        }));
      }
    }
    // Anonymous users: Allow tracking with session_id only (no PII)
    // This is considered functional/necessary for session management

    // Extract and anonymize IP address for GDPR compliance
    // Anonymization: IPv4 last octet zeroed, IPv6 last 80 bits zeroed
    const rawIpAddress = event.requestContext.identity?.sourceIp || null;
    const anonymizedIpAddress = anonymizeIp(rawIpAddress);
    const userAgent = event.requestContext.identity?.userAgent || null;

    const insertEvent = async (evt: TrackEventRequest) => {
      const query = `
      INSERT INTO analytics_events (
        event_type,
        user_id,
        session_id,
        content_id,
        metadata,
        ip_address,
        user_agent
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
      RETURNING id
    `;

      const values = [
        evt.eventType,
        userId,
        evt.sessionId || null,
        evt.contentId || null,
        JSON.stringify(evt.metadata || {}),
        anonymizedIpAddress,
        userAgent,
      ];

      const result = await pool.query(query, values);
      return result.rows[0].id as string;
    };

    if (events.length === 1) {
      const eventId = await insertEvent(events[0]);
      return withRateLimit(createSuccessResponse(201, {
        success: true,
        data: {
          eventId,
          tracked: true,
        },
      }));
    }

    const eventIds: string[] = [];
    for (const evt of events) {
      const id = await insertEvent(evt);
      eventIds.push(id);
    }

    return withRateLimit(createSuccessResponse(201, {
      success: true,
      data: {
        eventIds,
        tracked: true,
        count: eventIds.length,
      },
    }));
  } catch (error: any) {
    console.error('Track event error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to track event');
  }
}
