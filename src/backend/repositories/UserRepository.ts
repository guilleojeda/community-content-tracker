import { Pool, PoolClient } from 'pg';
import { BaseRepository, FindAllOptions } from './BaseRepository';
import { Visibility } from '@aws-community-hub/shared';
import type { User, SocialLinks } from '@aws-community-hub/shared';

export interface UserSearchOptions extends FindAllOptions {
  includeAwsEmployees?: boolean;
  includeAdmins?: boolean;
}

export interface UserValidationErrors {
  email?: string;
  username?: string;
  profileSlug?: string;
}

export interface UserCreateData {
  cognitoSub: string;
  email: string;
  username: string;
  profileSlug: string;
  defaultVisibility?: Visibility;
  isAdmin?: boolean;
  isAwsEmployee?: boolean;
  bio?: string | null;
  socialLinks?: SocialLinks | null;
  receiveNewsletter?: boolean;
  receiveContentNotifications?: boolean;
  receiveCommunityUpdates?: boolean;
}

export interface UserUpdateData {
  email?: string;
  username?: string;
  profileSlug?: string;
  defaultVisibility?: Visibility;
  isAdmin?: boolean;
  isAwsEmployee?: boolean;
  bio?: string | null;
  socialLinks?: SocialLinks | null;
  receiveNewsletter?: boolean;
  receiveContentNotifications?: boolean;
  receiveCommunityUpdates?: boolean;
}

export interface GDPRExportData {
  user: User;
  content: any[];
  badges: any[];
  channels: any[];
  bookmarks: any[];
  follows: {
    following: any[];
    followers: any[];
  };
  consents: any[];
  export_date: string;
}

/**
 * Repository for user-specific database operations
 * Extends BaseRepository with user-specific queries and admin checks
 */
export class UserRepository extends BaseRepository {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'users');
  }

  /**
   * Transform database row to User domain object
   */
  protected transformRow(row: any): User {
    if (!row) return row;

    return {
      id: row.id,
      cognitoSub: row.cognito_sub,
      email: row.email,
      username: row.username,
      profileSlug: row.profile_slug,
      defaultVisibility: row.default_visibility as Visibility,
      isAdmin: row.is_admin,
      isAwsEmployee: row.is_aws_employee,
      bio: row.bio ?? undefined,
      socialLinks: row.social_links ? (row.social_links as SocialLinks) : undefined,
      receiveNewsletter: row.receive_newsletter ?? undefined,
      receiveContentNotifications: row.receive_content_notifications ?? undefined,
      receiveCommunityUpdates: row.receive_community_updates ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Transform User domain object to database row
   */
  protected transformData(data: UserCreateData | UserUpdateData): any {
    const transformed: any = {};

    if ('cognitoSub' in data && data.cognitoSub !== undefined) transformed.cognito_sub = data.cognitoSub;
    if (data.email !== undefined) transformed.email = data.email;
    if (data.username !== undefined) transformed.username = data.username;
    if (data.profileSlug !== undefined) transformed.profile_slug = data.profileSlug;
    if (data.defaultVisibility !== undefined) transformed.default_visibility = data.defaultVisibility;
    if (data.isAdmin !== undefined) transformed.is_admin = data.isAdmin;
    if (data.isAwsEmployee !== undefined) transformed.is_aws_employee = data.isAwsEmployee;
    if (data.bio !== undefined) transformed.bio = data.bio;
    if (data.socialLinks !== undefined) transformed.social_links = data.socialLinks ?? {};
    if (data.receiveNewsletter !== undefined) transformed.receive_newsletter = data.receiveNewsletter;
    if (data.receiveContentNotifications !== undefined) {
      transformed.receive_content_notifications = data.receiveContentNotifications;
    }
    if (data.receiveCommunityUpdates !== undefined) transformed.receive_community_updates = data.receiveCommunityUpdates;

    return transformed;
  }

  /**
   * Find user by Cognito sub (unique identifier from Cognito)
   */
  async findByCognitoSub(cognitoSub: string): Promise<User | null> {
    const results = await this.findBy({ cognito_sub: cognitoSub });
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Find user by email address
   * Case-insensitive search
   */
  async findByEmail(email: string): Promise<User | null> {
    const query = `
      SELECT * FROM ${this.escapeIdentifier(this.tableName)}
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
    `;

    const result = await this.executeQuery(query, [email]);
    return result.rows.length > 0 ? this.transformRow(result.rows[0]) : null;
  }

  /**
   * Find user by username (case-sensitive)
   */
  async findByUsername(username: string): Promise<User | null> {
    const results = await this.findBy({ username });
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Find user by profile slug
   */
  async findByProfileSlug(profileSlug: string): Promise<User | null> {
    const results = await this.findBy({ profile_slug: profileSlug });
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Check if a user is an admin
   */
  async isAdmin(userId: string): Promise<boolean> {
    try {
      const user = await this.findById(userId);
      return user?.isAdmin || false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Find all admin users
   */
  async findAdmins(options: FindAllOptions = {}): Promise<User[]> {
    return this.findBy({ is_admin: true }, options);
  }

  /**
   * Find all AWS employees
   */
  async findAwsEmployees(options: FindAllOptions = {}): Promise<User[]> {
    return this.findBy({ is_aws_employee: true }, options);
  }

  /**
   * Update user's default visibility setting
   */
  async updateDefaultVisibility(userId: string, visibility: Visibility): Promise<User | null> {
    return this.update(userId, { defaultVisibility: visibility });
  }

  /**
   * Update user notification preferences
   */
  async updatePreferences(
    userId: string,
    preferences: {
      receiveNewsletter?: boolean;
      receiveContentNotifications?: boolean;
      receiveCommunityUpdates?: boolean;
    }
  ): Promise<User | null> {
    return this.update(userId, preferences);
  }

  /**
   * Search users by username or email
   * Uses full-text search with case-insensitive matching
   */
  async searchUsers(query: string, options: UserSearchOptions = {}): Promise<User[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const { limit = 20, offset, orderBy = 'username', orderDirection = 'ASC' } = options;

    // Escape special characters for LIKE search and add wildcards
    const searchTerm = `%${query.toLowerCase().replace(/[%_]/g, '\\$&')}%`;

    let sql = `
      SELECT * FROM ${this.escapeIdentifier(this.tableName)}
      WHERE (
        LOWER(username) LIKE $1
        OR LOWER(email) LIKE $1
      )
    `;

    const params: any[] = [searchTerm];
    let paramIndex = 2;

    // Add ordering
    sql += ` ORDER BY ${this.escapeIdentifier(orderBy)} ${orderDirection}`;

    // Add limit
    if (limit !== undefined) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(limit);
    }

    // Add offset
    if (offset !== undefined) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(offset);
    }

    const result = await this.executeQuery(sql, params);
    return result.rows.map((row: any) => this.transformRow(row));
  }

  /**
   * Get complete user profile (same as findById but with semantic meaning)
   */
  async getUserProfile(userId: string): Promise<User | null> {
    return this.findById(userId);
  }

  /**
   * Validate unique fields for user creation/update
   * Returns object with field errors or empty object if valid
   */
  async validateUniqueFields(
    fields: { email?: string; username?: string; profileSlug?: string },
    excludeUserId?: string
  ): Promise<UserValidationErrors> {
    const errors: UserValidationErrors = {};

    // Check email uniqueness
    if (fields.email) {
      let emailQuery = 'SELECT id FROM users WHERE LOWER(email) = LOWER($1)';
      const emailParams = [fields.email];

      if (excludeUserId) {
        emailQuery += ' AND id != $2';
        emailParams.push(excludeUserId);
      }

      const emailResult = await this.executeQuery(emailQuery, emailParams);
      if (emailResult.rows.length > 0) {
        errors.email = 'Email already exists';
      }
    }

    // Check username uniqueness
    if (fields.username) {
      let usernameQuery = 'SELECT id FROM users WHERE username = $1';
      const usernameParams = [fields.username];

      if (excludeUserId) {
        usernameQuery += ' AND id != $2';
        usernameParams.push(excludeUserId);
      }

      const usernameResult = await this.executeQuery(usernameQuery, usernameParams);
      if (usernameResult.rows.length > 0) {
        errors.username = 'Username already exists';
      }
    }

    // Check profile slug uniqueness
    if (fields.profileSlug) {
      let slugQuery = 'SELECT id FROM users WHERE profile_slug = $1';
      const slugParams = [fields.profileSlug];

      if (excludeUserId) {
        slugQuery += ' AND id != $2';
        slugParams.push(excludeUserId);
      }

      const slugResult = await this.executeQuery(slugQuery, slugParams);
      if (slugResult.rows.length > 0) {
        errors.profileSlug = 'Profile slug already exists';
      }
    }

    return errors;
  }

  /**
   * Create a new user with validation
   */
  async createUser(userData: UserCreateData): Promise<User> {
    // Validate unique fields
    const validationErrors = await this.validateUniqueFields({
      email: userData.email,
      username: userData.username,
      profileSlug: userData.profileSlug,
    });

    if (Object.keys(validationErrors).length > 0) {
      const error = new Error('Validation failed');
      (error as any).validationErrors = validationErrors;
      throw error;
    }

    return this.create(userData);
  }

  /**
   * Update user with validation
   */
  async updateUser(userId: string, userData: UserUpdateData): Promise<User | null> {
    // Only validate fields that are being updated
    const fieldsToValidate: any = {};
    if (userData.email !== undefined) fieldsToValidate.email = userData.email;
    if (userData.username !== undefined) fieldsToValidate.username = userData.username;
    if (userData.profileSlug !== undefined) fieldsToValidate.profileSlug = userData.profileSlug;

    if (Object.keys(fieldsToValidate).length > 0) {
      const validationErrors = await this.validateUniqueFields(fieldsToValidate, userId);

      if (Object.keys(validationErrors).length > 0) {
        const error = new Error('Validation failed');
        (error as any).validationErrors = validationErrors;
        throw error;
      }
    }

    return this.update(userId, userData);
  }

  /**
   * Find users by visibility preference
   */
  async findByVisibility(visibility: Visibility, options: FindAllOptions = {}): Promise<User[]> {
    return this.findBy({ default_visibility: visibility }, options);
  }

  /**
   * Get user statistics
   */
  async getUserStats(userId: string): Promise<any> {
    const query = `
      SELECT
        u.id,
        u.username,
        COUNT(DISTINCT c.id) as content_count,
        COUNT(DISTINCT ub.id) as badge_count,
        COUNT(DISTINCT f1.id) as followers_count,
        COUNT(DISTINCT f2.id) as following_count,
        COUNT(DISTINCT cb.id) as bookmarks_count
      FROM users u
      LEFT JOIN content c ON u.id = c.user_id
      LEFT JOIN user_badges ub ON u.id = ub.user_id
      LEFT JOIN user_follows f1 ON u.id = f1.following_id
      LEFT JOIN user_follows f2 ON u.id = f2.follower_id
      LEFT JOIN content_bookmarks cb ON u.id = cb.user_id
      WHERE u.id = $1
      GROUP BY u.id, u.username
    `;

    const result = await this.executeQuery(query, [userId]);
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      userId: row.id,
      username: row.username,
      contentCount: parseInt(row.content_count, 10),
      badgeCount: parseInt(row.badge_count, 10),
      followersCount: parseInt(row.followers_count, 10),
      followingCount: parseInt(row.following_count, 10),
      bookmarksCount: parseInt(row.bookmarks_count, 10),
    };
  }

  /**
   * GDPR: Export all user data
   */
  async exportUserData(userId: string): Promise<GDPRExportData | null> {
    if (process.env.TEST_DB_INMEMORY === 'true') {
      const userResult = await this.executeQuery(
        'SELECT * FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return null;
      }

      const contentResult = await this.executeQuery(
        'SELECT * FROM content WHERE user_id = $1 ORDER BY created_at DESC',
        [userId]
      );
      const badgeResult = await this.executeQuery(
        'SELECT * FROM user_badges WHERE user_id = $1 AND is_active = true',
        [userId]
      );
      const bookmarkResult = await this.executeQuery(
        'SELECT * FROM content_bookmarks WHERE user_id = $1',
        [userId]
      );
      const followingResult = await this.executeQuery(
        'SELECT * FROM user_follows WHERE follower_id = $1',
        [userId]
      );
      const followersResult = await this.executeQuery(
        'SELECT * FROM user_follows WHERE following_id = $1',
        [userId]
      );
      const channelResult = await this.executeQuery(
        'SELECT * FROM channels WHERE user_id = $1 ORDER BY created_at DESC',
        [userId]
      );
      const consentResult = await this.executeQuery(
        'SELECT * FROM user_consent WHERE user_id = $1',
        [userId]
      );

      const contentRows = contentResult.rows ?? [];
      let urlsByContent: Record<string, Array<{ id: string; url: string }>> = {};

      if (contentRows.length > 0) {
        const contentIds = contentRows.map((row: any) => row.id);
        const urlsResult = await this.executeQuery(
          'SELECT id, content_id, url FROM content_urls WHERE content_id = ANY($1::uuid[])',
          [contentIds]
        );

        urlsByContent = (urlsResult.rows ?? []).reduce<Record<string, Array<{ id: string; url: string }>>>(
          (acc, row) => {
            if (!acc[row.content_id]) {
              acc[row.content_id] = [];
            }
            acc[row.content_id].push({ id: row.id, url: row.url });
            return acc;
          },
          {}
        );
      }

      const contentWithUrls = contentRows.map((row: any) => ({
        ...row,
        urls: urlsByContent[row.id] ?? [],
      }));

      return {
        user: userResult.rows[0],
        content: contentWithUrls,
        badges: badgeResult.rows,
        channels: channelResult.rows,
        bookmarks: bookmarkResult.rows,
        follows: {
          following: followingResult.rows,
          followers: followersResult.rows,
        },
        consents: consentResult.rows,
        export_date: new Date().toISOString(),
      };
    }

    const query = 'SELECT export_user_data($1) as data';

    try {
      const result = await this.executeQuery(query, [userId]);
      if (result.rows.length === 0 || !result.rows[0].data) {
        return null;
      }

      return result.rows[0].data;
    } catch (error) {
      console.error('Error exporting user data:', error);
      throw new Error('Failed to export user data');
    }
  }

  /**
   * GDPR: Delete all user data
   */
  async deleteUserData(userId: string): Promise<boolean> {
    if (process.env.TEST_DB_INMEMORY === 'true') {
      const pool = this.pool as Pool;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM content_bookmarks WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM user_follows WHERE follower_id = $1 OR following_id = $1', [userId]);
        await client.query('DELETE FROM content WHERE user_id = $1', [userId]);
        const deleteResult = await client.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);
        await client.query('COMMIT');
        return (deleteResult?.rowCount ?? 0) > 0;
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error deleting user data:', error);
        throw new Error('Failed to delete user data');
      } finally {
        client.release();
      }
    }

    const query = 'SELECT delete_user_data($1) as deleted';

    try {
      const result = await this.executeQuery(query, [userId]);
      return result.rows[0]?.deleted || false;
    } catch (error) {
      console.error('Error deleting user data:', error);
      throw new Error('Failed to delete user data');
    }
  }

  /**
   * Find recently joined users
   */
  async findRecentUsers(days: number = 30, options: FindAllOptions = {}): Promise<User[]> {
    const query = `
      SELECT * FROM ${this.escapeIdentifier(this.tableName)}
      WHERE created_at >= NOW() - INTERVAL '${days} days'
      ORDER BY created_at DESC
      ${options.limit ? `LIMIT ${options.limit}` : ''}
      ${options.offset ? `OFFSET ${options.offset}` : ''}
    `;

    const result = await this.executeQuery(query);
    return result.rows.map((row: any) => this.transformRow(row));
  }

  /**
   * Find active users (users with recent content)
   */
  async findActiveUsers(days: number = 30, options: FindAllOptions = {}): Promise<User[]> {
    const query = `
      SELECT DISTINCT u.* FROM ${this.escapeIdentifier(this.tableName)} u
      INNER JOIN content c ON u.id = c.user_id
      WHERE c.created_at >= NOW() - INTERVAL '${days} days'
      ORDER BY u.username
      ${options.limit ? `LIMIT ${options.limit}` : ''}
      ${options.offset ? `OFFSET ${options.offset}` : ''}
    `;

    const result = await this.executeQuery(query);
    return result.rows.map((row: any) => this.transformRow(row));
  }

  /**
   * Promote user to admin
   */
  async promoteToAdmin(userId: string): Promise<User | null> {
    return this.update(userId, { isAdmin: true });
  }

  /**
   * Revoke admin privileges
   */
  async revokeAdmin(userId: string): Promise<User | null> {
    return this.update(userId, { isAdmin: false });
  }

  /**
   * Mark user as AWS employee
   */
  async markAsAwsEmployee(userId: string): Promise<User | null> {
    return this.update(userId, { isAwsEmployee: true });
  }

  /**
   * Remove AWS employee status
   */
  async removeAwsEmployeeStatus(userId: string): Promise<User | null> {
    return this.update(userId, { isAwsEmployee: false });
  }

  /**
   * Update AWS employee status (for test compatibility)
   */
  async updateAwsEmployeeStatus(userId: string, isAwsEmployee: boolean): Promise<User | null> {
    return this.update(userId, { isAwsEmployee });
  }

  /**
   * Get user's default visibility setting
   * Returns 'private' if user not found
   */
  async getDefaultVisibility(userId: string): Promise<Visibility> {
    try {
      const result = await this.pool.query<{ default_visibility: Visibility }>(
        'SELECT default_visibility FROM users WHERE id = $1',
        [userId]
      );
      const visibility = result.rows[0]?.default_visibility;
      return visibility || Visibility.PRIVATE;
    } catch (error) {
      console.error('Error fetching user default visibility:', error);
      return Visibility.PRIVATE;
    }
  }
}
