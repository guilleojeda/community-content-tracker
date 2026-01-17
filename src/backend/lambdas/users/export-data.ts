import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { UserRepository } from '../../repositories/UserRepository';
import {
  Channel,
  Content,
  ContentBookmark,
  User,
  UserDataExport,
  UserFollowEdge,
  UserConsentRecord,
  Badge,
  ConsentType
} from '../../../shared/types';
import {
  createErrorResponse,
} from '../auth/utils';
import { getDatabasePool } from '../../services/database';
import { AuditLogService } from '../../services/AuditLogService';
import { buildCorsHeaders } from '../../services/cors';
import { resolveAuthorizerContext } from '../../services/authorizerContext';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

const asDate = (value: any): Date => {
  if (value instanceof Date) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date value encountered: ${value}`);
  }
  return parsed;
};

const asOptionalDate = (value: any): Date | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  return asDate(value);
};

const serializeUser = (user: any): User => ({
  id: user.id,
  cognitoSub: user.cognitoSub ?? user.cognito_sub,
  email: user.email,
  username: user.username,
  profileSlug: user.profileSlug ?? user.profile_slug,
  bio: user.bio ?? undefined,
  socialLinks: user.socialLinks ?? user.social_links ?? undefined,
  defaultVisibility: user.defaultVisibility ?? user.default_visibility,
  isAdmin: Boolean(user.isAdmin ?? user.is_admin),
  isAwsEmployee: Boolean(user.isAwsEmployee ?? user.is_aws_employee),
  mfaEnabled: user.mfaEnabled ?? user.mfa_enabled ?? undefined,
  receiveNewsletter: user.receiveNewsletter ?? user.receive_newsletter ?? undefined,
  receiveContentNotifications: user.receiveContentNotifications ?? user.receive_content_notifications ?? undefined,
  receiveCommunityUpdates: user.receiveCommunityUpdates ?? user.receive_community_updates ?? undefined,
  createdAt: asDate(user.createdAt ?? user.created_at),
  updatedAt: asDate(user.updatedAt ?? user.updated_at),
});

const serializeContent = (content: any): Content => ({
  id: content.id,
  userId: content.userId ?? content.user_id,
  title: content.title,
  description: content.description ?? undefined,
  contentType: content.contentType ?? content.content_type,
  visibility: content.visibility,
  publishDate: asOptionalDate(content.publishDate ?? content.publish_date),
  captureDate: asDate(content.captureDate ?? content.capture_date ?? content.created_at),
  metrics: content.metrics ?? {},
  tags: content.tags ?? [],
  embedding: content.embedding ?? undefined,
  isClaimed: content.isClaimed ?? content.is_claimed ?? true,
  originalAuthor: content.originalAuthor ?? content.original_author ?? undefined,
  urls: (content.urls ?? []).map((url: any) => ({
    id: url.id,
    url: url.url,
  })),
  createdAt: asDate(content.createdAt ?? content.created_at),
  updatedAt: asDate(content.updatedAt ?? content.updated_at),
  deletedAt: asOptionalDate(content.deletedAt ?? content.deleted_at),
  version: Number(content.version ?? content.content_version ?? 1),
});

const serializeBadge = (badge: any): Badge => ({
  id: badge.id,
  userId: badge.userId ?? badge.user_id,
  badgeType: badge.badgeType ?? badge.badge_type,
  awardedAt: asDate(badge.awardedAt ?? badge.awarded_at),
  awardedBy: badge.awardedBy ?? badge.awarded_by ?? undefined,
  awardedReason: badge.awardedReason ?? badge.awarded_reason ?? undefined,
  metadata: badge.metadata ?? undefined,
  isActive: badge.isActive ?? badge.is_active ?? undefined,
  revokedAt: asOptionalDate(badge.revokedAt ?? badge.revoked_at),
  revokedBy: badge.revokedBy ?? badge.revoked_by ?? undefined,
  revokeReason: badge.revokeReason ?? badge.revoke_reason ?? undefined,
  createdAt: asDate(badge.createdAt ?? badge.created_at ?? badge.awarded_at ?? new Date()),
  updatedAt: asDate(badge.updatedAt ?? badge.updated_at ?? badge.awarded_at ?? new Date()),
});

const serializeChannel = (channel: any): Channel => ({
  id: channel.id,
  userId: channel.userId ?? channel.user_id,
  channelType: channel.channelType ?? channel.channel_type,
  url: channel.url,
  name: channel.name ?? undefined,
  enabled: channel.enabled ?? true,
  lastSyncAt: asOptionalDate(channel.lastSyncAt ?? channel.last_sync_at),
  lastSyncStatus: channel.lastSyncStatus ?? channel.last_sync_status ?? undefined,
  lastSyncError: channel.lastSyncError ?? channel.last_sync_error ?? undefined,
  syncFrequency: channel.syncFrequency ?? channel.sync_frequency ?? 'daily',
  metadata: channel.metadata ?? {},
  createdAt: asDate(channel.createdAt ?? channel.created_at),
  updatedAt: asDate(channel.updatedAt ?? channel.updated_at),
});

const serializeBookmark = (bookmark: any): ContentBookmark => ({
  id: bookmark.id,
  userId: bookmark.userId ?? bookmark.user_id,
  contentId: bookmark.contentId ?? bookmark.content_id,
  createdAt: asDate(bookmark.createdAt ?? bookmark.created_at),
});

const serializeFollowEdge = (edge: any): UserFollowEdge => ({
  followerId: edge.followerId ?? edge.follower_id,
  followingId: edge.followingId ?? edge.following_id,
  createdAt: asDate(edge.createdAt ?? edge.created_at),
});

const serializeConsent = (consent: any): UserConsentRecord => {
  const typeValue = consent.consentType ?? consent.consent_type;
  return {
    id: consent.id,
    consentType: typeValue as ConsentType,
    granted: Boolean(consent.granted),
    consentVersion: consent.consentVersion ?? consent.consent_version,
    grantedAt: asOptionalDate(consent.grantedAt ?? consent.granted_at),
    revokedAt: asOptionalDate(consent.revokedAt ?? consent.revoked_at),
    ipAddress: consent.ipAddress ?? consent.ip_address ?? undefined,
    userAgent: consent.userAgent ?? consent.user_agent ?? undefined,
    createdAt: asDate(consent.createdAt ?? consent.created_at),
    updatedAt: asDate(consent.updatedAt ?? consent.updated_at),
  };
};

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
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    const originHeader = event.headers?.Origin || event.headers?.origin || undefined;
    const corsOptions = { origin: originHeader, methods: 'GET,OPTIONS', allowCredentials: true };
    rateLimit = await applyRateLimit(event, { resource: 'users:export-data' });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(createErrorResponse(429, 'RATE_LIMITED', 'Too many requests', undefined, corsOptions));
    }

    const authContext = resolveAuthorizerContext(event.requestContext?.authorizer as any);
    if (!authContext.userId) {
      return withRateLimit(createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication required', undefined, corsOptions));
    }

    // Extract user ID from path parameters
    const rawUserId = event.pathParameters?.id;
    if (!rawUserId) {
      return withRateLimit(createErrorResponse(400, 'VALIDATION_ERROR', 'User ID is required', undefined, corsOptions));
    }
    const targetUserId = rawUserId === 'me' ? authContext.userId : rawUserId;

    // Check if authenticated user is exporting their own data (or is admin)
    if (authContext.userId !== targetUserId && !authContext.isAdmin) {
      return withRateLimit(
        createErrorResponse(403, 'PERMISSION_DENIED', 'You can only export your own data', undefined, corsOptions)
      );
    }

    // Export user data using repository method
    const dbPool = await getDatabasePool();
    const userRepository = new UserRepository(dbPool);
    const exportData = await userRepository.exportUserData(targetUserId);

    if (!exportData) {
      return withRateLimit(createErrorResponse(404, 'NOT_FOUND', 'User not found', undefined, corsOptions));
    }

    console.log('User data exported successfully for user:', targetUserId);

    const auditLogService = new AuditLogService(dbPool);
    await auditLogService.log({
      userId: authContext.userId,
      action: 'user.data.export',
      resourceType: 'user',
      resourceId: targetUserId,
      newValues: {
        exportedAt: new Date().toISOString(),
        exportOrigin: 'self_service',
      },
    });

    // Serialize dates to strings for JSON response
    // Return complete export data with serialized dates
    const response: UserDataExport = {
      user: serializeUser(exportData.user),
      content: (exportData.content || []).map(serializeContent),
      badges: (exportData.badges || []).map(serializeBadge),
      channels: (exportData.channels || []).map(serializeChannel),
      bookmarks: (exportData.bookmarks || []).map(serializeBookmark),
      follows: {
        following: (exportData.follows?.following || []).map(serializeFollowEdge),
        followers: (exportData.follows?.followers || []).map(serializeFollowEdge),
      },
      consents: (exportData.consents || []).map(serializeConsent),
      exportDate: (exportData.export_date ? asDate(exportData.export_date) : new Date()).toISOString(),
    };

    // Set content disposition for download
    return withRateLimit({
      statusCode: 200,
      headers: {
        ...buildCorsHeaders(corsOptions),
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="user-data-${targetUserId}-${new Date().toISOString()}.json"`,
      },
      body: JSON.stringify(response, null, 2),
    });
  } catch (error: any) {
    console.error('Unexpected export data error:', error);
    return attachRateLimitHeaders(
      createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred while exporting user data', undefined, {
        origin: event.headers?.Origin || event.headers?.origin || undefined,
        methods: 'GET,OPTIONS',
        allowCredentials: true,
      }),
      rateLimit
    );
  }
}
