import { Pool, PoolClient } from 'pg';
import { BaseRepository, FindAllOptions } from './BaseRepository';
import { BadgeType, Content, ContentType, Visibility } from '@aws-community-hub/shared';

export interface ContentSearchOptions extends FindAllOptions {
  viewerId?: string | null;
  filters?: {
    contentTypes?: ContentType[];
    tags?: string[];
    dateRange?: { start: Date; end: Date };
    visibility?: Visibility[];
  };
}

export interface ContentViewOptions extends ContentSearchOptions {
  includeAnalytics?: boolean;
}

export interface ContentStats {
  contentId: string;
  viewsCount: number;
  likesCount: number;
  sharesCount: number;
  commentsCount: number;
  engagementScore: number;
  lastUpdated: Date;
}

export interface ContentStatsUpdate {
  viewsCount?: number;
  likesCount?: number;
  sharesCount?: number;
  commentsCount?: number;
  engagementScore?: number;
}

export interface ContentCreateData {
  userId: string;
  title: string;
  description?: string;
  contentType: ContentType;
  visibility: Visibility;
  publishDate?: Date;
  isClaimed?: boolean;
  originalAuthor?: string;
  tags?: string[];
  urls?: string[];
}

export interface ContentUpdateData {
  title?: string;
  description?: string;
  contentType?: ContentType;
  visibility?: Visibility;
  publishDate?: Date;
  isClaimed?: boolean;
  originalAuthor?: string;
  tags?: string[];
}

/**
 * Repository for content-specific database operations
 * Handles visibility filtering and content search functionality
 */
export class ContentRepository extends BaseRepository {
  private static analyticsTableChecked = false;
  private static analyticsTableExists = false;

  constructor(pool: Pool | PoolClient) {
    super(pool, 'content');
  }

  private async profileQuery(sql: string, params: any[]): Promise<void> {
    if (process.env.ENABLE_QUERY_PROFILING !== 'true') {
      return;
    }

    try {
      const explainSql = `EXPLAIN ANALYZE ${sql}`;
      const result = await this.executeQuery(explainSql, params);
      const plan = result.rows.map(row => Object.values(row)[0]).join('\n');
      console.debug('[QueryProfile]', plan);
    } catch (error: any) {
      console.warn('Failed to profile query:', error.message || error);
    }
  }

  private async ensureAnalyticsTable(): Promise<void> {
    if (ContentRepository.analyticsTableChecked) {
      return;
    }

    try {
      const result = await this.executeQuery(
        `SELECT to_regclass('public.content_analytics') AS table_exists`
      );
      ContentRepository.analyticsTableExists = Boolean(result.rows[0]?.table_exists);
    } catch (error) {
      ContentRepository.analyticsTableExists = false;
    } finally {
      ContentRepository.analyticsTableChecked = true;
    }
  }

  /**
   * Transform database row to Content domain object
   */
  protected transformRow(row: any): Content {
    if (!row) return row;

    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      description: row.description,
      contentType: row.content_type as ContentType,
      visibility: row.visibility as Visibility,
      publishDate: row.publish_date,
      captureDate: row.capture_date,
      metrics: row.metrics || {},
      tags: row.tags || [],
      embedding: row.embedding,
      isClaimed: row.is_claimed,
      originalAuthor: row.original_author,
      urls: row.urls || [], // Will be populated by join or separate query
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at ?? undefined,
      version: row.version ?? 1,
    };
  }

  /**
   * Transform Content domain object to database row
   */
  protected transformData(data: ContentCreateData | ContentUpdateData): any {
    const transformed: any = {};

    if ('userId' in data && data.userId !== undefined) transformed.user_id = data.userId;
    if (data.title !== undefined) transformed.title = data.title;
    if (data.description !== undefined) transformed.description = data.description;
    if (data.contentType !== undefined) transformed.content_type = data.contentType;
    if (data.visibility !== undefined) transformed.visibility = data.visibility;
    if (data.publishDate !== undefined) transformed.publish_date = data.publishDate;
    if (data.isClaimed !== undefined) transformed.is_claimed = data.isClaimed;
    if (data.originalAuthor !== undefined) transformed.original_author = data.originalAuthor;
    if (data.tags !== undefined) transformed.tags = data.tags;

    return transformed;
  }

  private async getViewerContext(viewerId: string): Promise<{
    exists: boolean;
    isAdmin: boolean;
    isAwsEmployee: boolean;
    hasCommunityBadge: boolean;
  }> {
    const userResult = await this.executeQuery(
      `SELECT is_admin, is_aws_employee FROM users WHERE id = $1`,
      [viewerId]
    );

    if (userResult.rows.length === 0) {
      return {
        exists: false,
        isAdmin: false,
        isAwsEmployee: false,
        hasCommunityBadge: false,
      };
    }

    const badgeResult = await this.executeQuery(
      `SELECT badge_type FROM user_badges WHERE user_id = $1 AND is_active = true`,
      [viewerId]
    );
    const communityBadges = new Set([
      BadgeType.COMMUNITY_BUILDER,
      BadgeType.HERO,
      BadgeType.AMBASSADOR,
      BadgeType.USER_GROUP_LEADER,
    ]);

    const hasCommunityBadge = badgeResult.rows.some((row: any) =>
      communityBadges.has(row.badge_type as BadgeType)
    );

    const userRow = userResult.rows[0];
    return {
      exists: true,
      isAdmin: userRow.is_admin === true,
      isAwsEmployee: userRow.is_aws_employee === true,
      hasCommunityBadge,
    };
  }

  /**
   * Build visibility filter based on viewer permissions
   */
  private async buildVisibilityFilter(viewerId?: string | null): Promise<{ clause: string; params: any[] }> {
    if (!viewerId) {
      return {
        clause: 'AND c.visibility::text = $PARAM',
        params: [Visibility.PUBLIC],
      };
    }

    const context = await this.getViewerContext(viewerId);
    const allowedVisibilities = new Set<Visibility>([Visibility.PUBLIC]);

    if (context.isAwsEmployee || context.isAdmin) {
      allowedVisibilities.add(Visibility.AWS_COMMUNITY);
      allowedVisibilities.add(Visibility.AWS_ONLY);
    } else if (context.hasCommunityBadge) {
      allowedVisibilities.add(Visibility.AWS_COMMUNITY);
    }

    return {
      clause: `
        AND (
          c.user_id = $PARAM
          OR c.visibility::text = ANY($PARAM::text[])
        )
      `,
      params: [viewerId, Array.from(allowedVisibilities)],
    };
  }

  /**
   * Execute query with visibility filtering
   */
  private async executeContentQuery(
    baseQuery: string,
    params: any[],
    viewerId?: string | null
  ): Promise<Content[]> {
    const visibilityFilter = await this.buildVisibilityFilter(viewerId);

    // First, replace $VISIBILITY_FILTER with the clause
    let query = baseQuery.replace('$VISIBILITY_FILTER', visibilityFilter.clause);
    const currentParams = [...params];

    // Then, replace $PARAM placeholders with actual parameter indices
    visibilityFilter.params.forEach(param => {
      const paramIndex = currentParams.length + 1;
      query = query.replace('$PARAM', `$${paramIndex}`);
      currentParams.push(param);
    });

    const result = await this.executeQuery(query, currentParams);
    const rowsWithUrls = await this.attachUrls(result.rows);
    return rowsWithUrls.map((row: any) => this.transformRow(row));
  }

  /**
   * Attach associated URLs to content rows
   */
  private async attachUrls(rows: any[]): Promise<any[]> {
    if (!rows || rows.length === 0) {
      return [];
    }

    const contentIds = rows.map((row: any) => row.id);
    const placeholders = contentIds.map((_, index) => `$${index + 1}`).join(', ');
    const urlsResult = await this.executeQuery(
      `
        SELECT content_id, id, url
        FROM content_urls
        WHERE content_id IN (${placeholders})
        ORDER BY created_at ASC
      `,
      contentIds
    );

    const urlsByContent = new Map<string, Array<{ id: string; url: string }>>();
    urlsResult.rows.forEach((row: any) => {
      if (!urlsByContent.has(row.content_id)) {
        urlsByContent.set(row.content_id, []);
      }
      urlsByContent.get(row.content_id)!.push({
        id: row.id,
        url: row.url,
      });
    });

    return rows.map(row => ({
      ...row,
      urls: urlsByContent.get(row.id) ?? [],
    }));
  }

  /**
   * Find content by user ID with visibility filtering
   */
  async findByUserId(userId: string, options: ContentViewOptions = {}): Promise<Content[]> {
    const {
      viewerId,
      limit,
      offset,
      orderBy = 'created_at',
      orderDirection = 'DESC',
      filters = {},
    } = options;

    let baseQuery = `
      SELECT c.*
      FROM content c
      WHERE c.user_id = $1
      $VISIBILITY_FILTER
    `;

    const params: any[] = [userId];
    let paramIndex = params.length;

    if (filters.contentTypes && filters.contentTypes.length > 0) {
      const placeholders = filters.contentTypes.map(() => `$${++paramIndex}`).join(', ');
      baseQuery += ` AND c.content_type IN (${placeholders})`;
      params.push(...filters.contentTypes);
    }

    if (filters.visibility && filters.visibility.length > 0) {
      const placeholders = filters.visibility.map(() => `$${++paramIndex}`).join(', ');
      baseQuery += ` AND c.visibility IN (${placeholders})`;
      params.push(...filters.visibility);
    }

    if (filters.tags && filters.tags.length > 0) {
      const tagConditions = filters.tags
        .map(() => `c.tags && ARRAY[$${++paramIndex}]`)
        .join(' OR ');
      baseQuery += ` AND (${tagConditions})`;
      params.push(...filters.tags);
    }

    if (filters.dateRange) {
      const { start, end } = filters.dateRange;
      if (start && end && start <= end) {
        baseQuery += ` AND c.publish_date BETWEEN $${++paramIndex} AND $${++paramIndex}`;
        params.push(start, end);
      } else if (start && end) {
        // Invalid range prevents matches
        baseQuery += ' AND FALSE';
      }
    }

    const safeOrderDirection = orderDirection.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    baseQuery += ` ORDER BY ${this.escapeIdentifier(orderBy)} ${safeOrderDirection}`;

    if (limit) {
      baseQuery += ` LIMIT $${++paramIndex}`;
      params.push(limit);
    }

    if (offset) {
      baseQuery += ` OFFSET $${++paramIndex}`;
      params.push(offset);
    }

    return this.executeContentQuery(baseQuery, params, viewerId);
  }

  /**
   * Find content by content type with visibility filtering
   */
  async findByContentType(
    contentType: ContentType,
    options: ContentSearchOptions = {}
  ): Promise<Content[]> {
    const { viewerId, limit, offset, orderBy = 'created_at', orderDirection = 'DESC' } = options;

    let baseQuery = `
      SELECT c.*
      FROM content c
      WHERE c.content_type = $1
      $VISIBILITY_FILTER
      ORDER BY ${this.escapeIdentifier(orderBy)} ${orderDirection}
    `;

    const params: any[] = [contentType];

    if (limit) {
      baseQuery += ` LIMIT $${params.length + 1}`;
      params.push(limit);
    }

    if (offset) {
      baseQuery += ` OFFSET $${params.length + 1}`;
      params.push(offset);
    }

    return this.executeContentQuery(baseQuery, params, viewerId);
  }

  /**
   * Find content by visibility level
   */
  async findByVisibility(visibility: Visibility, options: FindAllOptions = {}): Promise<Content[]> {
    const { limit, offset, orderBy = 'created_at', orderDirection = 'DESC' } = options;

    let query = `
      SELECT c.*
      FROM content c
      WHERE c.visibility = $1
      ORDER BY ${this.escapeIdentifier(orderBy)} ${orderDirection}
    `;

    const params: any[] = [visibility];

    if (limit) {
      query += ` LIMIT $${params.length + 1}`;
      params.push(limit);
    }

    if (offset) {
      query += ` OFFSET $${params.length + 1}`;
      params.push(offset);
    }

    await this.profileQuery(query, params);
    const result = await this.executeQuery(query, params);
    const rowsWithUrls = await this.attachUrls(result.rows);
    return rowsWithUrls.map((row: any) => this.transformRow(row));
  }

  /**
   * Find all public content
   */
  async findPublicContent(options: FindAllOptions = {}): Promise<Content[]> {
    return this.findByVisibility(Visibility.PUBLIC, options);
  }

  /**
   * Search content with full-text search and filtering
   */
  async searchContent(query: string, options: ContentSearchOptions = {}): Promise<Content[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const {
      viewerId,
      limit = 20,
      offset,
      orderBy = 'created_at',
      orderDirection = 'DESC',
      filters = {},
    } = options;

    const searchTerm = `%${query.toLowerCase().replace(/[%_]/g, '\\$&')}%`;
    const params: any[] = [searchTerm];
    let paramIndex = params.length;

    let baseQuery = `
      SELECT c.id, c.user_id, c.title, c.description, c.content_type, c.visibility,
        c.publish_date, c.capture_date, c.metrics, c.tags, c.embedding,
        c.is_claimed, c.original_author, c.created_at, c.updated_at
      FROM content c
      WHERE (
        LOWER(c.title) LIKE $1
        OR LOWER(c.description) LIKE $1
        OR LOWER(COALESCE(c.tags::text, '')) LIKE $1
      )
      $VISIBILITY_FILTER
    `;

    // Apply content type filter
    if (filters.contentTypes && filters.contentTypes.length > 0) {
      const placeholders = filters.contentTypes.map(() => `$${++paramIndex}`).join(', ');
      baseQuery += ` AND c.content_type IN (${placeholders})`;
      params.push(...filters.contentTypes);
    }

    // Apply tags filter
    if (filters.tags && filters.tags.length > 0) {
      const tagConditions = filters.tags.map(() => `c.tags && ARRAY[$${++paramIndex}]`).join(' OR ');
      baseQuery += ` AND (${tagConditions})`;
      params.push(...filters.tags);
    }

    // Apply date range filter
    if (filters.dateRange) {
      if (filters.dateRange.start <= filters.dateRange.end) {
        baseQuery += ` AND c.publish_date BETWEEN $${++paramIndex} AND $${++paramIndex}`;
        params.push(filters.dateRange.start, filters.dateRange.end);
      } else {
        // Invalid date range (start > end) - return empty results
        baseQuery += ` AND FALSE`;
      }
    }

    // Apply visibility filter (additional to the visibility filtering)
    if (filters.visibility && filters.visibility.length > 0) {
      const placeholders = filters.visibility.map(() => `$${++paramIndex}`).join(', ');
      baseQuery += ` AND c.visibility IN (${placeholders})`;
      params.push(...filters.visibility);
    }

    baseQuery += ` ORDER BY ${this.escapeIdentifier(orderBy)} ${orderDirection}`;

    if (limit) {
      baseQuery += ` LIMIT $${++paramIndex}`;
      params.push(limit);
    }

    if (offset) {
      baseQuery += ` OFFSET $${++paramIndex}`;
      params.push(offset);
    }

    return this.executeContentQuery(baseQuery, params, viewerId);
  }

  /**
   * Find recent content from the last N days
   */
  async findRecentContent(days: number = 30, options: ContentSearchOptions = {}): Promise<Content[]> {
    const { viewerId, limit, offset, orderBy = 'created_at', orderDirection = 'DESC' } = options;

    const baseQuery = `
      SELECT c.*
      FROM content c
      WHERE c.created_at >= NOW() - INTERVAL '${days} days'
      $VISIBILITY_FILTER
      ORDER BY ${this.escapeIdentifier(orderBy)} ${orderDirection}
      ${limit ? `LIMIT ${limit}` : ''}
      ${offset ? `OFFSET ${offset}` : ''}
    `;

    return this.executeContentQuery(baseQuery, [], viewerId);
  }

  /**
   * Find trending content based on engagement metrics
   */
  async findTrendingContent(options: ContentSearchOptions = {}): Promise<Content[]> {
    const { viewerId, limit = 20, offset } = options;

    const baseQuery = `
      SELECT c.*, COALESCE(ca.engagement_score, 0) as engagement_score
      FROM content c
      LEFT JOIN content_analytics ca ON c.id = ca.content_id
      WHERE 1=1
      $VISIBILITY_FILTER
      ORDER BY engagement_score DESC, c.created_at DESC
      ${limit ? `LIMIT ${limit}` : ''}
      ${offset ? `OFFSET ${offset}` : ''}
    `;

    return this.executeContentQuery(baseQuery, [], viewerId);
  }

  /**
   * Find content by tags
   */
  async findByTags(tags: string[], options: ContentSearchOptions = {}): Promise<Content[]> {
    if (tags.length === 0) {
      return [];
    }

    const { viewerId, limit, offset, orderBy = 'created_at', orderDirection = 'DESC' } = options;

    const tagConditions = tags.map((_, index) => `c.tags && ARRAY[$${index + 1}]`).join(' OR ');

    const baseQuery = `
      SELECT c.*
      FROM content c
      WHERE (${tagConditions})
      $VISIBILITY_FILTER
      ORDER BY ${this.escapeIdentifier(orderBy)} ${orderDirection}
      ${limit ? `LIMIT ${limit}` : ''}
      ${offset ? `OFFSET ${offset}` : ''}
    `;

    return this.executeContentQuery(baseQuery, [...tags], viewerId);
  }

  /**
   * Get content statistics
   */
  async getContentStats(contentId: string): Promise<ContentStats | null> {
    const query = `
      SELECT
        ca.content_id,
        COALESCE(ca.views_count, 0) as views_count,
        COALESCE(ca.likes_count, 0) as likes_count,
        COALESCE(ca.shares_count, 0) as shares_count,
        COALESCE(ca.comments_count, 0) as comments_count,
        COALESCE(ca.engagement_score, 0.0) as engagement_score,
        COALESCE(ca.last_updated, NOW()) as last_updated
      FROM content c
      LEFT JOIN content_analytics ca ON c.id = ca.content_id
      WHERE c.id = $1
    `;

    const result = await this.executeQuery(query, [contentId]);
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      contentId: contentId,
      viewsCount: parseInt(row.views_count, 10),
      likesCount: parseInt(row.likes_count, 10),
      sharesCount: parseInt(row.shares_count, 10),
      commentsCount: parseInt(row.comments_count, 10),
      engagementScore: parseFloat(row.engagement_score),
      lastUpdated: row.last_updated,
    };
  }

  /**
   * Update content analytics/statistics
   */
  async updateContentStats(contentId: string, stats: ContentStatsUpdate): Promise<boolean> {
    // First, check if the content exists
    const contentExists = await this.exists(contentId);
    if (!contentExists) {
      return false;
    }

    const updates: string[] = [];
    const columnNames: string[] = [];
    const values: any[] = [contentId];
    let paramIndex = 2;

    if (stats.viewsCount !== undefined) {
      columnNames.push('views_count');
      updates.push(`views_count = $${paramIndex++}`);
      values.push(stats.viewsCount);
    }

    if (stats.likesCount !== undefined) {
      columnNames.push('likes_count');
      updates.push(`likes_count = $${paramIndex++}`);
      values.push(stats.likesCount);
    }

    if (stats.sharesCount !== undefined) {
      columnNames.push('shares_count');
      updates.push(`shares_count = $${paramIndex++}`);
      values.push(stats.sharesCount);
    }

    if (stats.commentsCount !== undefined) {
      columnNames.push('comments_count');
      updates.push(`comments_count = $${paramIndex++}`);
      values.push(stats.commentsCount);
    }

    if (stats.engagementScore !== undefined) {
      columnNames.push('engagement_score');
      updates.push(`engagement_score = $${paramIndex++}`);
      values.push(stats.engagementScore);
    }

    if (updates.length === 0) {
      return true; // No updates to perform
    }

    columnNames.push('last_updated');
    updates.push('last_updated = NOW()');

    const query = `
      INSERT INTO content_analytics (content_id, ${columnNames.join(', ')})
      VALUES ($1, ${values.slice(1).map((_, i) => `$${i + 2}`).join(', ')}, NOW())
      ON CONFLICT (content_id)
      DO UPDATE SET ${updates.join(', ')}
    `;

    try {
      await this.executeQuery(query, values);
      return true;
    } catch (error) {
      console.error('Error updating content stats:', error);
      return false;
    }
  }

  /**
   * Create content with URLs
   */
  async createContent(data: ContentCreateData): Promise<Content> {
    const { urls, ...contentData } = data;

    // Use transaction for atomic creation
    if ('release' in this.pool) {
      // Already in transaction
      return this.performContentCreation(contentData, urls);
    }

    const client = await (this.pool as Pool).connect();
    try {
      await client.query('BEGIN');

      const tempRepo = new ContentRepository(client);
      const result = await tempRepo.performContentCreation(contentData, urls);

      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Perform content creation with URLs
   */
  private async performContentCreation(
    contentData: Omit<ContentCreateData, 'urls'>,
    urls?: string[]
  ): Promise<Content> {
    await this.ensureAnalyticsTable();

    let content;
    try {
      content = await this.create(contentData);
    } catch (error) {
      console.error('Failed to create content record', { error, contentData });
      throw error;
    }

    // Create analytics record (optional table)
    if (ContentRepository.analyticsTableExists) {
      await this.executeQuery(
        `
          INSERT INTO content_analytics (content_id)
          VALUES ($1)
        `,
        [content.id]
      );
    }

    // Add URLs if provided
    if (urls && urls.length > 0) {
      for (const url of urls) {
        await this.executeQuery(`
          INSERT INTO content_urls (content_id, url)
          VALUES ($1, $2)
        `, [content.id, url]);
      }
    }

    // Fetch the complete content with URLs
    const result = await this.findById(content.id);
    if (!result) {
      throw new Error('Failed to fetch created content');
    }
    return result;
  }

  /**
   * Override findById to include URLs
   */
  async findById(id: string): Promise<Content | null> {
    const query = `
      SELECT *
      FROM content
      WHERE id = $1
    `;

    const result = await this.executeQuery(query, [id]);
    if (result.rows.length === 0) {
      return null;
    }

    const [rowWithUrls] = await this.attachUrls(result.rows);
    return this.transformRow(rowWithUrls);
  }

  /**
   * Get popular tags
   */
  async getPopularTags(limit: number = 20): Promise<{ tag: string; count: number }[]> {
    const query = `
      SELECT tag, COUNT(*) as count
      FROM (
        SELECT unnest(tags) as tag
        FROM content
        WHERE visibility = 'public'
      ) t
      GROUP BY tag
      ORDER BY count DESC
      LIMIT $1
    `;

    const result = await this.executeQuery(query, [limit]);
    return result.rows.map((row: any) => ({
      tag: row.tag,
      count: parseInt(row.count, 10),
    }));
  }

  /**
   * Find similar content using shared tags to surface related items.
   */
  async findSimilarContent(contentId: string, limit: number = 5): Promise<Content[]> {
    // For now, find content with similar tags
    const targetContent = await this.findById(contentId);
    if (!targetContent || !targetContent.tags.length) {
      return [];
    }

    return this.findByTags(targetContent.tags, {
      limit: limit + 1,
      viewerId: null, // Only public content for similarity
    }).then(results => results.filter(c => c.id !== contentId).slice(0, limit));
  }

  /**
   * Get content by date range
   */
  async findByDateRange(
    startDate: Date,
    endDate: Date,
    options: ContentSearchOptions = {}
  ): Promise<Content[]> {
    const { viewerId, limit, offset, orderBy = 'publish_date', orderDirection = 'DESC' } = options;

    const baseQuery = `
      SELECT c.*
      FROM content c
      WHERE c.publish_date BETWEEN $1 AND $2
      $VISIBILITY_FILTER
      ORDER BY ${this.escapeIdentifier(orderBy)} ${orderDirection}
      ${limit ? `LIMIT ${limit}` : ''}
      ${offset ? `OFFSET ${offset}` : ''}
    `;

    return this.executeContentQuery(baseQuery, [startDate, endDate], viewerId);
  }

  /**
   * Find multiple content items by IDs
   */
  async findByIds(ids: string[]): Promise<Content[]> {
    if (ids.length === 0) {
      return [];
    }

    const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
    const query = `
      SELECT *
      FROM content
      WHERE id IN (${placeholders})
    `;

    const result = await this.executeQuery(query, ids);
    const rowsWithUrls = await this.attachUrls(result.rows);
    return rowsWithUrls.map((row: any) => this.transformRow(row));
  }

  /**
   * Find unclaimed content for claiming
   */
  async findUnclaimedContent(options: ContentSearchOptions = {}): Promise<Content[]> {
    const { viewerId, limit, offset, orderBy = 'created_at', orderDirection = 'DESC' } = options;

    const baseQuery = `
      SELECT c.*
      FROM content c
      WHERE c.is_claimed = false
      $VISIBILITY_FILTER
      ORDER BY ${this.escapeIdentifier(orderBy)} ${orderDirection}
      ${limit ? `LIMIT ${limit}` : ''}
      ${offset ? `OFFSET ${offset}` : ''}
    `;

    return this.executeContentQuery(baseQuery, [], viewerId);
  }

  /**
   * Claim content for a user
   */
  async claimContent(
    contentId: string,
    userId: string,
    options: { requestId?: string; sourceIp?: string; force?: boolean } = {}
  ): Promise<Content | null> {
    const forceClaim = options.force === true;

    const query = `
      UPDATE content
      SET
        is_claimed = true,
        user_id = $2,
        claimed_at = NOW(),
        updated_at = NOW(),
        version = version + 1
      WHERE id = $1${forceClaim ? '' : ' AND (is_claimed = false OR user_id IS NULL)'}
      RETURNING *
    `;

    const result = await this.executeQuery(query, [contentId, userId]);
    if (result.rows.length === 0) {
      return null;
    }

    // Fetch complete content with URLs
    return this.findById(contentId);
  }

  /**
   * Bulk claim multiple content items
   */
  async bulkClaimContent(
    contentIds: string[],
    userId: string
  ): Promise<Array<{ contentId: string; success: boolean; error?: string }>> {
    const results: Array<{ contentId: string; success: boolean; error?: string }> = [];

    for (const contentId of contentIds) {
      try {
        const claimed = await this.claimContent(contentId, userId);
        results.push({
          contentId,
          success: claimed !== null,
          error: claimed ? undefined : 'Content not found or already claimed',
        });
      } catch (error) {
        results.push({
          contentId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  /**
   * Soft delete content
   */
  async deleteContent(contentId: string, soft: boolean = true): Promise<boolean> {
    if (soft) {
      // Use database function for soft delete
      const query = `SELECT soft_delete_content($1)`;
      const result = await this.executeQuery(query, [contentId]);
      return result.rows[0].soft_delete_content === true;
    } else {
      // Hard delete
      const query = `DELETE FROM content WHERE id = $1`;
      const result = await this.executeQuery(query, [contentId]);
      return result.rowCount > 0;
    }
  }

  /**
   * Restore soft-deleted content
   */
  async restoreContent(contentId: string): Promise<boolean> {
    const query = `SELECT restore_content($1)`;
    const result = await this.executeQuery(query, [contentId]);
    return result.rows[0].restore_content === true;
  }

  /**
   * Merge multiple content items into one
   */
  async mergeContent(
    primaryId: string,
    contentIds: string[],
    mergedBy: string,
    reason?: string
  ): Promise<Content> {
    // Use transaction for atomic merge
    if ('release' in this.pool) {
      return this.performMerge(primaryId, contentIds, mergedBy, reason);
    }

    const client = await (this.pool as Pool).connect();
    try {
      await client.query('BEGIN');

      const tempRepo = new ContentRepository(client);
      const result = await tempRepo.performMerge(primaryId, contentIds, mergedBy, reason);

      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Perform the actual merge operation
   */
  private async performMerge(
    primaryId: string,
    contentIds: string[],
    mergedBy: string,
    reason?: string
  ): Promise<Content> {
    // Get all content items
    const allIds = [primaryId, ...contentIds];
    const contents = await this.findByIds(allIds);

    if (contents.length !== allIds.length) {
      throw new Error('One or more content items not found');
    }

    // Find primary content
    const primary = contents.find(c => c.id === primaryId);
    if (!primary) {
      throw new Error('Primary content not found');
    }

    // Collect all URLs from all content items
    const allUrls = new Set<string>();
    contents.forEach(content => {
      content.urls.forEach(urlObj => {
        if (typeof urlObj === 'string') {
          allUrls.add(urlObj);
        } else if (urlObj && typeof urlObj === 'object' && 'url' in urlObj) {
          allUrls.add(urlObj.url);
        }
      });
    });

    // Find earliest publish date
    const publishDates = contents
      .map(c => c.publishDate)
      .filter((d): d is Date => d !== null && d !== undefined);
    const earliestDate = publishDates.length > 0
      ? new Date(Math.min(...publishDates.map(d => d.getTime())))
      : primary.publishDate;

    // Merge tags (unique)
    const allTags = new Set<string>();
    contents.forEach(c => c.tags.forEach(tag => allTags.add(tag)));

    // Find best metadata (longest title and description)
    const bestTitle = contents.reduce((longest, current) =>
      current.title.length > longest.title.length ? current : longest
    ).title;

    const bestDescription = contents
      .filter(c => c.description)
      .reduce((longest, current) =>
        (current.description?.length || 0) > (longest.description?.length || 0) ? current : longest
      , primary).description;

    // Update primary content with merged data
    const updateQuery = `
      UPDATE content
      SET
        title = $2,
        description = $3,
        publish_date = $4,
        tags = $5,
        updated_at = NOW(),
        version = version + 1
      WHERE id = $1
    `;

    await this.executeQuery(updateQuery, [
      primaryId,
      bestTitle,
      bestDescription,
      earliestDate,
      Array.from(allTags),
    ]);

    // Add all URLs to primary content (deduplicated)
    for (const url of allUrls) {
      await this.executeQuery(`
        INSERT INTO content_urls (content_id, url)
        VALUES ($1, $2)
        ON CONFLICT (content_id, url) DO NOTHING
      `, [primaryId, url]);
    }

    // Soft delete the merged content items
    for (const contentId of contentIds) {
      await this.deleteContent(contentId, true);
    }

    // Record merge in history table
    const undo_deadline = new Date();
    undo_deadline.setDate(undo_deadline.getDate() + 30); // 30 days undo window

    await this.executeQuery(`
      INSERT INTO content_merge_history (
        primary_content_id,
        merged_content_ids,
        merged_by,
        merge_reason,
        merged_metadata,
        can_undo,
        undo_deadline
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      primaryId,
      contentIds,
      mergedBy,
      reason || 'Manual merge',
      JSON.stringify({ contentCount: contentIds.length, urlCount: allUrls.size }),
      true,
      undo_deadline,
    ]);

    // Return updated content
    const result = await this.findById(primaryId);
    if (!result) {
      throw new Error('Failed to fetch merged content');
    }
    return result;
  }

  /**
   * Unmerge content (undo a merge operation)
   */
  async unmergeContent(mergeId: string): Promise<boolean> {
    // Get merge history
    const historyQuery = `
      SELECT * FROM content_merge_history
      WHERE id = $1 AND can_undo = true
    `;

    const historyResult = await this.executeQuery(historyQuery, [mergeId]);
    if (historyResult.rows.length === 0) {
      throw new Error('Merge not found or cannot be undone');
    }

    const mergeRecord = historyResult.rows[0];

    // Check if undo deadline has passed
    if (new Date(mergeRecord.undo_deadline) < new Date()) {
      throw new Error('Undo deadline has passed (30 days)');
    }

    // Restore all merged content items
    for (const contentId of mergeRecord.merged_content_ids) {
      await this.restoreContent(contentId);
    }

    // Mark merge as undone
    await this.executeQuery(`
      UPDATE content_merge_history
      SET can_undo = false, updated_at = NOW()
      WHERE id = $1
    `, [mergeId]);

    return true;
  }

  /**
   * Get merge history for content
   */
  async getMergeHistory(contentId?: string, limit: number = 50): Promise<any[]> {
    let query = `
      SELECT
        cmh.*,
        u.username as merged_by_username,
        c.title as primary_content_title
      FROM content_merge_history cmh
      LEFT JOIN users u ON cmh.merged_by = u.id
      LEFT JOIN content c ON cmh.primary_content_id = c.id
    `;

    const values: any[] = [];

    if (contentId) {
      query += ` WHERE cmh.primary_content_id = $1 OR $1 = ANY(cmh.merged_content_ids)`;
      values.push(contentId);
    }

    query += ` ORDER BY cmh.created_at DESC LIMIT $${values.length + 1}`;
    values.push(limit);

    const result = await this.executeQuery(query, values);
    return result.rows;
  }

  /**
   * Rollback a merge (alias for unmergeContent)
   */
  async rollbackMerge(mergeId: string): Promise<boolean> {
    return this.unmergeContent(mergeId);
  }

  /**
   * Find content by URL
   */
  async findByUrl(url: string): Promise<Content | null> {
    const query = `
      SELECT *
      FROM content
      WHERE id IN (
        SELECT content_id FROM content_urls WHERE url = $1
      )
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await this.executeQuery(query, [url]);
    if (result.rows.length === 0) {
      return null;
    }

    const [rowWithUrls] = await this.attachUrls(result.rows);
    return this.transformRow(rowWithUrls);
  }

  /**
   * Update content with embedding support
   */
  async updateWithEmbedding(
    contentId: string,
    data: ContentUpdateData & { embedding?: number[]; metadata?: Record<string, any> },
    options: { expectedVersion?: number } = {}
  ): Promise<Content | null> {
    const { embedding, metadata, ...updateData } = data;
    const { expectedVersion } = options;

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Standard updates
    const transformedData = this.transformData(updateData);
    for (const [key, value] of Object.entries(transformedData)) {
      updates.push(`${key} = $${paramIndex++}`);
      values.push(value);
    }

    // Handle embedding
    if (embedding !== undefined) {
      const isInMemory = process.env.TEST_DB_INMEMORY === 'true';
      if (embedding.length === 0) {
        updates.push(`embedding = NULL`);
      } else if (isInMemory) {
        updates.push(`embedding = $${paramIndex++}::jsonb`);
        values.push(JSON.stringify(embedding));
      } else {
        updates.push(`embedding = $${paramIndex++}::vector`);
        values.push(`[${embedding.join(',')}]`);
      }
    }

    // Handle metadata (stored in metrics JSONB field)
    if (metadata !== undefined) {
      updates.push(`metrics = $${paramIndex++}::jsonb`);
      values.push(JSON.stringify(metadata));
    }

    const hasFieldMutations = updates.length > 0;
    if (!hasFieldMutations) {
      return this.findById(contentId);
    }

    updates.push(`updated_at = NOW()`);
    updates.push(`version = version + 1`);

    let whereClause = `id = $${paramIndex}`;
    values.push(contentId);
    paramIndex += 1;

    if (expectedVersion !== undefined) {
      whereClause += ` AND version = $${paramIndex}`;
      values.push(expectedVersion);
      paramIndex += 1;
    }

    const query = `
      UPDATE content
      SET ${updates.join(', ')}
      WHERE ${whereClause}
      RETURNING *
    `;

    const result = await this.executeQuery(query, values);
    return result.rows.length > 0 ? this.findById(contentId) : null;
  }

  /**
   * Semantic search using vector similarity
   * Returns content ordered by similarity to the query embedding
   */
  async semanticSearch(
    queryEmbedding: number[],
    options: {
      visibilityLevels: Visibility[];
      ownerVisibilityLevels?: Visibility[];
      viewerId?: string;
      contentTypes?: ContentType[];
      tags?: string[];
      badges?: import('@aws-community-hub/shared').BadgeType[];
      dateRange?: { start: Date; end: Date };
      ownerId?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<Array<Content & { similarity?: number }>> {
    const {
      visibilityLevels,
      ownerVisibilityLevels,
      viewerId,
      contentTypes,
      tags,
      badges,
      dateRange,
      ownerId,
      limit = 20,
      offset = 0,
    } = options;

    const baseVisibility = visibilityLevels.filter((visibility) => visibility !== Visibility.PRIVATE);
    const ownerVisibility =
      viewerId && ownerVisibilityLevels && ownerVisibilityLevels.length > 0
        ? ownerVisibilityLevels
        : undefined;

    let query = `
      SELECT
        c.*,
        1 - (c.embedding <=> $1::vector) as similarity
      FROM content c
      WHERE c.embedding IS NOT NULL
        AND (
          c.visibility = ANY($2::visibility_enum[])
          ${ownerVisibility ? 'OR (c.user_id = $3 AND c.visibility = ANY($4::visibility_enum[]))' : ''}
        )
    `;

    const params: any[] = [`[${queryEmbedding.join(',')}]`, baseVisibility];
    let paramIndex = 3;

    if (ownerVisibility) {
      params.push(viewerId as string, ownerVisibility);
      paramIndex = 5;
    }

    // Filter by content types
    if (contentTypes && contentTypes.length > 0) {
      query += ` AND c.content_type = ANY($${paramIndex}::content_type_enum[])`;
      params.push(contentTypes);
      paramIndex++;
    }

    // Filter by tags
    if (tags && tags.length > 0) {
      query += ` AND c.tags && $${paramIndex}::text[]`;
      params.push(tags);
      paramIndex++;
    }

    // Filter by date range
    if (dateRange) {
      query += ` AND c.publish_date BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
      params.push(dateRange.start, dateRange.end);
      paramIndex += 2;
    }

    // Filter by owner
    if (ownerId) {
      query += ` AND c.user_id = $${paramIndex}`;
      params.push(ownerId);
      paramIndex++;
    }

    // Filter by user badges (if specified)
    if (badges && badges.length > 0) {
      query += ` AND EXISTS (
        SELECT 1 FROM user_badges ub
        WHERE ub.user_id = c.user_id
        AND ub.badge_type = ANY($${paramIndex}::badge_enum[])
      )`;
      params.push(badges);
      paramIndex++;
    }

    query += `
      ORDER BY c.embedding <=> $1::vector
      LIMIT $${paramIndex}
      OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    await this.profileQuery(query, params);
    const result = await this.executeQuery(query, params);
    const rowsWithUrls = await this.attachUrls(result.rows);
    return rowsWithUrls.map((row: any) => ({
      ...this.transformRow(row),
      similarity: row.similarity !== undefined ? Number(row.similarity) : undefined,
    }));
  }

  /**
   * Keyword search using PostgreSQL full-text search
   * Returns content ordered by text match relevance
   */
  async keywordSearch(
    searchQuery: string,
    options: {
      visibilityLevels: Visibility[];
      ownerVisibilityLevels?: Visibility[];
      viewerId?: string;
      contentTypes?: ContentType[];
      tags?: string[];
      badges?: import('@aws-community-hub/shared').BadgeType[];
      dateRange?: { start: Date; end: Date };
      ownerId?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<Array<Content & { rank?: number }>> {
    const {
      visibilityLevels,
      ownerVisibilityLevels,
      viewerId,
      contentTypes,
      tags,
      badges,
      dateRange,
      ownerId,
      limit = 20,
      offset = 0,
    } = options;

    const baseVisibility = visibilityLevels.filter((visibility) => visibility !== Visibility.PRIVATE);
    const ownerVisibility =
      viewerId && ownerVisibilityLevels && ownerVisibilityLevels.length > 0
        ? ownerVisibilityLevels
        : undefined;
    const isInMemory = process.env.TEST_DB_INMEMORY === 'true';

    if (isInMemory) {
      let simpleQuery = `
        SELECT
          c.*,
          (
            CASE
              WHEN LOWER(c.title) LIKE $1 THEN 1
              ELSE 0
            END +
            CASE
              WHEN LOWER(COALESCE(c.description, '')) LIKE $1 THEN 1
              ELSE 0
            END
          )::numeric AS rank
        FROM content c
        WHERE c.deleted_at IS NULL
          AND (
            LOWER(c.title) LIKE $1
            OR LOWER(COALESCE(c.description, '')) LIKE $1
          )
      `;

      const loweredSearch = `%${searchQuery.toLowerCase().replace(/[%_]/g, '\\$&')}%`;
      const fallbackParams: any[] = [loweredSearch];
      let fallbackIndex = 2;

      if (contentTypes && contentTypes.length > 0) {
        simpleQuery += ` AND c.content_type::text = ANY($${fallbackIndex}::text[])`;
        fallbackParams.push(contentTypes);
        fallbackIndex++;
      }

      if (tags && tags.length > 0) {
        simpleQuery += ` AND c.tags && $${fallbackIndex}::text[]`;
        fallbackParams.push(tags);
        fallbackIndex++;
      }

      if (dateRange) {
        simpleQuery += ` AND c.publish_date BETWEEN $${fallbackIndex} AND $${fallbackIndex + 1}`;
        fallbackParams.push(dateRange.start, dateRange.end);
        fallbackIndex += 2;
      }

      if (ownerId) {
        simpleQuery += ` AND c.user_id = $${fallbackIndex}`;
        fallbackParams.push(ownerId);
        fallbackIndex++;
      }

      if (badges && badges.length > 0) {
        simpleQuery += ` AND EXISTS (
          SELECT 1 FROM user_badges ub
          WHERE ub.user_id = c.user_id
          AND ub.badge_type::text = ANY($${fallbackIndex}::text[])
        )`;
        fallbackParams.push(badges);
        fallbackIndex++;
      }
      simpleQuery += `
        ORDER BY rank DESC, c.created_at DESC
      `;

      await this.profileQuery(simpleQuery, fallbackParams);
      const fallbackResult = await this.executeQuery(simpleQuery, fallbackParams);
      const rowsWithUrls = await this.attachUrls(fallbackResult.rows);
      const filtered = rowsWithUrls.filter((row: any) => {
        const visibilityValue = row.visibility ?? Visibility.PUBLIC;
        const visibilityMatches = baseVisibility.includes(visibilityValue as Visibility);
        const ownerMatches = ownerId ? row.user_id === ownerId : false;
        const viewerMatches =
          viewerId &&
          ownerVisibilityLevels &&
          row.user_id === viewerId &&
          ownerVisibilityLevels.includes(visibilityValue as Visibility);
        return visibilityMatches || ownerMatches || viewerMatches;
      });

      const paginated = filtered.slice(offset, offset + limit);

      return paginated.map((row: any) => ({
        ...this.transformRow(row),
        rank: row.rank !== undefined ? Number(row.rank) : undefined,
      }));
    }

    let query = `
      SELECT
        c.*,
        ts_rank(
          to_tsvector('english', c.title || ' ' || COALESCE(c.description, '')),
          plainto_tsquery('english', $1)
        ) as rank
      FROM content c
      WHERE to_tsvector('english', c.title || ' ' || COALESCE(c.description, ''))
            @@ plainto_tsquery('english', $1)
        AND (
          c.visibility = ANY($2::visibility_enum[])
          ${ownerVisibility ? 'OR (c.user_id = $3 AND c.visibility = ANY($4::visibility_enum[]))' : ''}
        )
    `;

    const params: any[] = [searchQuery, baseVisibility];
    let paramIndex = 3;

    if (ownerVisibility) {
      params.push(viewerId as string, ownerVisibility);
      paramIndex = 5;
    }

    // Filter by content types
    if (contentTypes && contentTypes.length > 0) {
      query += ` AND c.content_type = ANY($${paramIndex}::content_type_enum[])`;
      params.push(contentTypes);
      paramIndex++;
    }

    // Filter by tags
    if (tags && tags.length > 0) {
      query += ` AND c.tags && $${paramIndex}::text[]`;
      params.push(tags);
      paramIndex++;
    }

    // Filter by date range
    if (dateRange) {
      query += ` AND c.publish_date BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
      params.push(dateRange.start, dateRange.end);
      paramIndex += 2;
    }

    // Filter by owner
    if (ownerId) {
      query += ` AND c.user_id = $${paramIndex}`;
      params.push(ownerId);
      paramIndex++;
    }

    // Filter by user badges (if specified)
    if (badges && badges.length > 0) {
      query += ` AND EXISTS (
        SELECT 1 FROM user_badges ub
        WHERE ub.user_id = c.user_id
        AND ub.badge_type = ANY($${paramIndex}::badge_enum[])
      )`;
      params.push(badges);
      paramIndex++;
    }

    query += `
      ORDER BY rank DESC, c.created_at DESC
      LIMIT $${paramIndex}
      OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    await this.profileQuery(query, params);
    const result = await this.executeQuery(query, params);
    const rowsWithUrls = await this.attachUrls(result.rows);
    return rowsWithUrls.map((row: any) => ({
      ...this.transformRow(row),
      rank: row.rank !== undefined ? Number(row.rank) : undefined,
    }));
  }

  /**
   * Count total search results for pagination
   * Uses the same filters as semantic/keyword search
   */
  async countSearchResults(
    options: {
      visibilityLevels: Visibility[];
      ownerVisibilityLevels?: Visibility[];
      viewerId?: string;
      contentTypes?: ContentType[];
      tags?: string[];
      badges?: import('@aws-community-hub/shared').BadgeType[];
      dateRange?: { start: Date; end: Date };
      ownerId?: string;
    }
  ): Promise<number> {
    const { visibilityLevels, ownerVisibilityLevels, viewerId, contentTypes, tags, badges, dateRange, ownerId } = options;

    const baseVisibility = visibilityLevels.filter((visibility) => visibility !== Visibility.PRIVATE);
    const ownerVisibility =
      viewerId && ownerVisibilityLevels && ownerVisibilityLevels.length > 0
        ? ownerVisibilityLevels
        : undefined;

    let query = `
      SELECT COUNT(DISTINCT c.id) as total
      FROM content c
      WHERE (
        c.visibility = ANY($1::visibility_enum[])
        ${ownerVisibility ? 'OR (c.user_id = $2 AND c.visibility = ANY($3::visibility_enum[]))' : ''}
      )
    `;

    const params: any[] = [baseVisibility];
    let paramIndex = 2;

    if (ownerVisibility) {
      params.push(viewerId as string, ownerVisibility);
      paramIndex = 4;
    }

    // Filter by content types
    if (contentTypes && contentTypes.length > 0) {
      query += ` AND c.content_type = ANY($${paramIndex}::content_type_enum[])`;
      params.push(contentTypes);
      paramIndex++;
    }

    // Filter by tags
    if (tags && tags.length > 0) {
      query += ` AND c.tags && $${paramIndex}::text[]`;
      params.push(tags);
      paramIndex++;
    }

    // Filter by date range
    if (dateRange) {
      query += ` AND c.publish_date BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
      params.push(dateRange.start, dateRange.end);
      paramIndex += 2;
    }

    // Filter by owner
    if (ownerId) {
      query += ` AND c.user_id = $${paramIndex}`;
      params.push(ownerId);
      paramIndex++;
    }

    // Filter by user badges (if specified)
    if (badges && badges.length > 0) {
      query += ` AND EXISTS (
        SELECT 1 FROM user_badges ub
        WHERE ub.user_id = c.user_id
        AND ub.badge_type = ANY($${paramIndex}::badge_enum[])
      )`;
      params.push(badges);
      paramIndex++;
    }

    const result = await this.executeQuery(query, params);
    return parseInt(result.rows[0].total, 10);
  }

  /**
   * Find duplicate content using multiple detection strategies
   * Supports title similarity (using pg_trgm), tag matching, and URL comparison
   */
  async findDuplicates(
    userId: string,
    threshold: number = 0.8,
    fields: string[] = ['title', 'tags'],
    contentId?: string
  ): Promise<Array<{ content: Content; similarity: number; matchedFields: string[] }>> {
    // First, get all user's content
    const allContent = await this.findByUserId(userId, { viewerId: userId });

    // If no content or only one item, return empty
    if (allContent.length <= 1) {
      return [];
    }

    // If contentId is specified, find duplicates for that specific content
    let targetContent: Content | null = null;
    if (contentId) {
      targetContent = await this.findById(contentId);
      if (!targetContent) {
        throw new Error('Content not found');
      }
    }

    // Find duplicates by comparing each content item
    const duplicates: Array<{ content: Content; similarity: number; matchedFields: string[] }> = [];

    for (const content of allContent) {
      // Skip if comparing to itself
      if (targetContent && content.id === targetContent.id) {
        continue;
      }

      // If no target content, compare all items with each other
      if (!targetContent) {
        // For general duplicate detection without a specific target,
        // we need to compare each item with every other item
        // This is done by checking against all previous items
        const previousContent = allContent.slice(0, allContent.indexOf(content));
        for (const prevContent of previousContent) {
          const result = await this.compareTwoContentItems(
            prevContent,
            content,
            threshold,
            fields
          );
          if (result.similarity >= threshold && result.matchedFields.length > 0) {
            // Add to duplicates if not already present
            const existing = duplicates.find(d => d.content.id === content.id);
            if (!existing) {
              duplicates.push({
                content,
                similarity: result.similarity,
                matchedFields: result.matchedFields,
              });
            }
          }
        }
        continue;
      }

      // Compare with target content
      const result = await this.compareTwoContentItems(
        targetContent,
        content,
        threshold,
        fields
      );

      if (result.similarity >= threshold && result.matchedFields.length > 0) {
        duplicates.push({
          content,
          similarity: result.similarity,
          matchedFields: result.matchedFields,
        });
      }
    }

    // Sort by similarity (highest first)
    return duplicates.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Compare two content items and calculate similarity
   */
  private async compareTwoContentItems(
    content1: Content,
    content2: Content,
    threshold: number,
    fields: string[]
  ): Promise<{ similarity: number; matchedFields: string[] }> {
    const matchedFields: string[] = [];
    let totalSimilarity = 0;
    let fieldCount = 0;

    // Title similarity
    if (fields.includes('title')) {
      const titleSimilarityQuery = `SELECT similarity($1, $2) as score`;
      const titleResult = await this.executeQuery(titleSimilarityQuery, [
        content1.title,
        content2.title,
      ]);
      const titleSimilarity = parseFloat(titleResult.rows[0].score);

      if (titleSimilarity >= threshold) {
        matchedFields.push('title');
        totalSimilarity += titleSimilarity;
        fieldCount++;
      }
    }

    // Tag similarity
    if (fields.includes('tags')) {
      const tags1 = content1.tags || [];
      const tags2 = content2.tags || [];

      if (tags1.length > 0 && tags2.length > 0) {
        const commonTags = tags1.filter(tag => tags2.includes(tag));
        if (commonTags.length > 0) {
          matchedFields.push('tags');
          // Jaccard similarity for tags
          const tagSimilarity = commonTags.length / Math.max(tags1.length, tags2.length);
          totalSimilarity += tagSimilarity;
          fieldCount++;
        }
      }
    }

    // URL similarity
    if (fields.includes('urls')) {
      const urls1 = content1.urls.map((u: any) =>
        typeof u === 'string' ? u : (u.url || '')
      ).filter(u => u);
      const urls2 = content2.urls.map((u: any) =>
        typeof u === 'string' ? u : (u.url || '')
      ).filter(u => u);

      if (urls1.length > 0 && urls2.length > 0) {
        const commonUrls = urls1.filter((url: string) => urls2.includes(url));
        if (commonUrls.length > 0) {
          matchedFields.push('urls');
          // Jaccard similarity for URLs
          const urlSimilarity = commonUrls.length / Math.max(urls1.length, urls2.length);
          totalSimilarity += urlSimilarity;
          fieldCount++;
        }
      }
    }

    // Calculate average similarity
    const avgSimilarity = fieldCount > 0 ? totalSimilarity / fieldCount : 0;

    return {
      similarity: avgSimilarity,
      matchedFields,
    };
  }
}
