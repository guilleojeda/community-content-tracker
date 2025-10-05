import { Pool, PoolClient } from 'pg';
import { BaseRepository, FindAllOptions } from './BaseRepository';
import { Badge, BadgeType, User } from '@aws-community-hub/shared';

export interface BadgeCreateData {
  userId: string;
  badgeType: BadgeType;
  awardedBy?: string;
  awardedReason?: string;
}

export interface BadgeUpdateData {
  badgeType?: BadgeType;
  awardedBy?: string;
  awardedReason?: string;
  awardedAt?: Date;
}

export interface BadgeWithUser extends Badge {
  user?: User;
}

export interface BadgeStats {
  badgeType: BadgeType;
  count: number;
  percentage: number;
  lastAwarded?: Date;
}

/**
 * Repository for badge-specific database operations
 * Manages user badges and achievements
 */
export class BadgeRepository extends BaseRepository {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'user_badges');
  }

  /**
   * Transform database row to Badge domain object
   */
  protected transformRow(row: any): Badge {
    if (!row) return row;

    return {
      id: row.id,
      userId: row.user_id,
      badgeType: row.badge_type as BadgeType,
      awardedAt: row.awarded_at,
      awardedBy: row.awarded_by ?? undefined,
      awardedReason: row.awarded_reason ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Transform Badge domain object to database row
   */
  protected transformData(data: BadgeCreateData | BadgeUpdateData): any {
    const transformed: any = {};

    if ('userId' in data && data.userId !== undefined) {
      transformed.user_id = data.userId;
    }
    if (data.badgeType !== undefined) transformed.badge_type = data.badgeType;
    if (data.awardedBy !== undefined) transformed.awarded_by = data.awardedBy;
    if (data.awardedReason !== undefined) transformed.awarded_reason = data.awardedReason;
    if ('awardedAt' in data && data.awardedAt !== undefined) {
      transformed.awarded_at = data.awardedAt;
    }

    return transformed;
  }

  /**
   * Find all badges for a specific user
   */
  async findByUserId(userId: string, options: FindAllOptions = {}): Promise<Badge[]> {
    const { orderBy = 'awarded_at', orderDirection = 'DESC' } = options;
    return this.findBy({ user_id: userId }, { ...options, orderBy, orderDirection });
  }

  /**
   * Find all badges of a specific type
   */
  async findByBadgeType(badgeType: BadgeType, options: FindAllOptions = {}): Promise<Badge[]> {
    const { orderBy = 'awarded_at', orderDirection = 'DESC' } = options;
    return this.findBy({ badge_type: badgeType }, { ...options, orderBy, orderDirection });
  }

  /**
   * Check if user has a specific badge type
   */
  async userHasBadge(userId: string, badgeType: BadgeType): Promise<boolean> {
    const query = `
      SELECT 1 FROM ${this.escapeIdentifier(this.tableName)}
      WHERE user_id = $1 AND badge_type = $2
      LIMIT 1
    `;

    const result = await this.executeQuery(query, [userId, badgeType]);
    return result.rows.length > 0;
  }

  /**
   * Award a badge to a user
   * Ensures no duplicate badges of the same type per user
   */
  async awardBadge(data: BadgeCreateData): Promise<Badge> {
    // Check if user already has this badge type
    const hasBadge = await this.userHasBadge(data.userId, data.badgeType);
    if (hasBadge) {
      throw new Error(`User already has badge type: ${data.badgeType}`);
    }

    // Set awarded_at timestamp if not provided
    const badgeData = {
      ...data,
      awardedAt: new Date(),
    };

    return this.create(badgeData);
  }

  /**
   * Revoke a badge from a user
   */
  async revokeBadge(userId: string, badgeType: BadgeType): Promise<boolean> {
    const query = `
      DELETE FROM ${this.escapeIdentifier(this.tableName)}
      WHERE user_id = $1 AND badge_type = $2
    `;

    const result = await this.executeQuery(query, [userId, badgeType]);
    return result.rowCount > 0;
  }

  /**
   * Get badge with user information
   */
  async findBadgeWithUser(badgeId: string): Promise<BadgeWithUser | null> {
    const query = `
      SELECT
        b.*,
        u.id as user_id,
        u.email as user_email,
        u.username as user_username,
        u.profile_slug as user_profile_slug,
        u.is_admin as user_is_admin,
        u.is_aws_employee as user_is_aws_employee
      FROM ${this.escapeIdentifier(this.tableName)} b
      INNER JOIN users u ON b.user_id = u.id
      WHERE b.id = $1
    `;

    const result = await this.executeQuery(query, [badgeId]);
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const badge = this.transformRow(row);

    return {
      ...badge,
      user: {
        id: row.user_id,
        email: row.user_email,
        username: row.user_username,
        profileSlug: row.user_profile_slug,
        isAdmin: row.user_is_admin,
        isAwsEmployee: row.user_is_aws_employee,
      } as User,
    };
  }

  /**
   * Get badges awarded by a specific admin
   */
  async findBadgesAwardedBy(adminId: string, options: FindAllOptions = {}): Promise<Badge[]> {
    const { orderBy = 'awarded_at', orderDirection = 'DESC' } = options;
    return this.findBy({ awarded_by: adminId }, { ...options, orderBy, orderDirection });
  }

  /**
   * Get badge statistics across all users
   */
  async getBadgeStatistics(): Promise<BadgeStats[]> {
    const query = `
      SELECT
        badge_type,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(DISTINCT id) FROM users), 2) as percentage,
        MAX(awarded_at) as last_awarded
      FROM ${this.escapeIdentifier(this.tableName)}
      GROUP BY badge_type
      ORDER BY count DESC
    `;

    const result = await this.executeQuery(query);

    return result.rows.map((row: any) => ({
      badgeType: row.badge_type as BadgeType,
      count: parseInt(row.count, 10),
      percentage: parseFloat(row.percentage),
      lastAwarded: row.last_awarded,
    }));
  }

  /**
   * Get users with specific badge type
   */
  async getUsersWithBadge(badgeType: BadgeType, options: FindAllOptions = {}): Promise<any[]> {
    const { limit, offset, orderBy = 'b.awarded_at', orderDirection = 'DESC' } = options;

    let query = `
      SELECT
        u.*,
        b.awarded_at,
        b.awarded_reason
      FROM users u
      INNER JOIN ${this.escapeIdentifier(this.tableName)} b ON u.id = b.user_id
      WHERE b.badge_type = $1
      ORDER BY ${orderBy} ${orderDirection}
    `;

    const params: any[] = [badgeType];
    let paramIndex = 2;

    if (limit !== undefined) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(limit);
    }

    if (offset !== undefined) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(offset);
    }

    const result = await this.executeQuery(query, params);

    return result.rows.map((row: any) => ({
      id: row.id,
      email: row.email,
      username: row.username,
      profileSlug: row.profile_slug,
      isAdmin: row.is_admin,
      isAwsEmployee: row.is_aws_employee,
      awardedAt: row.awarded_at,
      awardedReason: row.awarded_reason,
    }));
  }

  /**
   * Get recent badge awards
   */
  async getRecentBadges(days: number = 30, options: FindAllOptions = {}): Promise<Badge[]> {
    const { limit, offset } = options;

    let query = `
      SELECT * FROM ${this.escapeIdentifier(this.tableName)}
      WHERE awarded_at >= NOW() - INTERVAL '${days} days'
      ORDER BY awarded_at DESC
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (limit !== undefined) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(limit);
    }

    if (offset !== undefined) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(offset);
    }

    const result = await this.executeQuery(query, params);
    return result.rows.map((row: any) => this.transformRow(row));
  }

  /**
   * Award multiple badges in a transaction
   */
  async awardMultipleBadges(badges: BadgeCreateData[]): Promise<Badge[]> {
    if (badges.length === 0) {
      return [];
    }

    // If we have a PoolClient (already in transaction), use it directly
    if ('release' in this.pool) {
      return this.performBulkAward(badges);
    }

    // Otherwise, create a transaction
    const client = await (this.pool as Pool).connect();
    try {
      await client.query('BEGIN');

      const tempRepo = new BadgeRepository(client);
      const results = await tempRepo.performBulkAward(badges);

      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Perform bulk badge award operation
   */
  private async performBulkAward(badges: BadgeCreateData[]): Promise<Badge[]> {
    const results: Badge[] = [];

    for (const badgeData of badges) {
      // Check if user already has this badge type
      const hasBadge = await this.userHasBadge(badgeData.userId, badgeData.badgeType);
      if (!hasBadge) {
        const badge = await this.create({
          ...badgeData,
          awardedAt: new Date(),
        });
        results.push(badge);
      }
    }

    return results;
  }

  /**
   * Get user's badge count
   */
  async getUserBadgeCount(userId: string): Promise<number> {
    const query = `
      SELECT COUNT(*) as count
      FROM ${this.escapeIdentifier(this.tableName)}
      WHERE user_id = $1
    `;

    const result = await this.executeQuery(query, [userId]);
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Check eligibility for Community Builder badge
   * (Example: User has created at least 10 pieces of content)
   */
  async checkCommunityBuilderEligibility(userId: string): Promise<boolean> {
    const query = `
      SELECT COUNT(*) as content_count
      FROM content
      WHERE user_id = $1 AND is_claimed = true
    `;

    const result = await this.executeQuery(query, [userId]);
    const contentCount = parseInt(result.rows[0].content_count, 10);

    return contentCount >= 10;
  }

  /**
   * Check eligibility for Hero badge
   * (Example: User has received 100+ total views/engagement)
   */
  async checkHeroEligibility(userId: string): Promise<boolean> {
    const query = `
      SELECT
        SUM((metrics->>'views')::int) as total_views
      FROM content
      WHERE user_id = $1
    `;

    const result = await this.executeQuery(query, [userId]);
    const totalViews = parseInt(result.rows[0].total_views || '0', 10);

    return totalViews >= 100;
  }

  /**
   * Auto-award eligible badges to a user
   */
  async autoAwardBadges(userId: string, awardedBy?: string): Promise<Badge[]> {
    const awardedBadges: Badge[] = [];

    // Check Community Builder eligibility
    if (await this.checkCommunityBuilderEligibility(userId)) {
      const hasBadge = await this.userHasBadge(userId, BadgeType.COMMUNITY_BUILDER);
      if (!hasBadge) {
        const badge = await this.awardBadge({
          userId,
          badgeType: BadgeType.COMMUNITY_BUILDER,
          awardedBy,
          awardedReason: 'Created 10+ pieces of content',
        });
        awardedBadges.push(badge);
      }
    }

    // Check Hero eligibility
    if (await this.checkHeroEligibility(userId)) {
      const hasBadge = await this.userHasBadge(userId, BadgeType.HERO);
      if (!hasBadge) {
        const badge = await this.awardBadge({
          userId,
          badgeType: BadgeType.HERO,
          awardedBy,
          awardedReason: 'Achieved 100+ content views',
        });
        awardedBadges.push(badge);
      }
    }

    return awardedBadges;
  }

  /**
   * Grant a badge (alias for awardBadge for test compatibility)
   */
  async grantBadge(data: BadgeCreateData): Promise<Badge> {
    return this.awardBadge(data);
  }

  /**
   * Bulk grant badges (alias for awardMultipleBadges for test compatibility)
   */
  async bulkGrantBadges(badges: BadgeCreateData[]): Promise<Badge[]> {
    return this.awardMultipleBadges(badges);
  }

  /**
   * Get badge history for a user
   * Returns all badge operations (grants and revocations) from audit log
   */
  async getBadgeHistory(userId: string, limit: number = 50): Promise<any[]> {
    const query = `
      SELECT
        al.*,
        au.username as admin_username,
        au.email as admin_email
      FROM audit_log al
      LEFT JOIN users au ON al.user_id = au.id
      WHERE al.resource_type = 'user_badge'
        AND al.resource_id = $1
        AND al.action IN ('badge.grant', 'badge.revoke')
      ORDER BY al.created_at DESC
      LIMIT $2
    `;

    const result = await this.executeQuery(query, [userId, limit]);
    return result.rows.map((row: any) => ({
      id: row.id,
      action: row.action,
      badgeType: row.new_values?.badgeType || row.old_values?.badgeType,
      reason: row.new_values?.reason,
      grantedBy: row.user_id,
      grantedByUsername: row.admin_username,
      createdAt: row.created_at,
      metadata: row.new_values,
    }));
  }
}