import { SearchRequest, Content, BadgeType, ContentType, Visibility } from '../../shared/types';
import { ContentRepository } from '../repositories/ContentRepository';
import { EmbeddingService } from './EmbeddingService';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { InternalError } from '../../shared/errors';

/**
 * Result of a search operation with pagination metadata
 */
export interface SearchResult {
  items: Content[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Internal type for ranked content with similarity/rank scores
 */
interface RankedContent extends Content {
  similarity?: number;
  rank?: number;
  combinedScore?: number;
}

/**
 * Search Service implementing hybrid search with semantic and keyword approaches
 * Combines pgvector similarity search (70%) with PostgreSQL full-text search (30%)
 */
export class SearchService {
  private readonly SEMANTIC_WEIGHT = 0.7;
  private readonly KEYWORD_WEIGHT = 0.3;

  constructor(
    private readonly contentRepo: ContentRepository,
    private readonly embeddingService: EmbeddingService,
    private readonly cloudwatch: CloudWatchClient
  ) {}

  /**
   * Execute hybrid search combining semantic and keyword approaches
   *
   * @param request - Search request with query and filters
   * @param isAuthenticated - Whether user is authenticated
   * @param userBadges - User's badges for visibility filtering
   * @param isAwsEmployee - Whether user is an AWS employee (for AWS_ONLY content)
   * @returns Paginated search results
   */
  async search(
    request: SearchRequest,
    isAuthenticated: boolean,
    userBadges: BadgeType[] = [],
    isAwsEmployee: boolean = false
  ): Promise<SearchResult> {
    const startTime = Date.now();
    const { query, filters = {}, limit = 20, offset = 0 } = request;

    try {
      // Validate inputs
      if (!query || query.trim().length === 0) {
        return {
          items: [],
          total: 0,
          limit,
          offset,
        };
      }

      // Determine visibility levels based on authentication and badges
      const visibilityLevels = this.determineVisibility(isAuthenticated, userBadges, isAwsEmployee);

      const requestedVisibility = filters.visibility?.filter(visibility =>
        visibilityLevels.includes(visibility)
      );

      if (filters.visibility && (!requestedVisibility || requestedVisibility.length === 0)) {
        return {
          items: [],
          total: 0,
          limit,
          offset,
        };
      }

      const effectiveVisibilityLevels =
        requestedVisibility && requestedVisibility.length > 0 ? requestedVisibility : visibilityLevels;

      const normalizedFilters = {
        contentTypes: filters.contentTypes,
        tags: filters.tags,
        badges: filters.badges,
        dateRange: filters.dateRange,
        visibility: requestedVisibility && requestedVisibility.length > 0 ? requestedVisibility : undefined,
      };

      // Generate embedding for semantic search
      const queryEmbedding = await this.embeddingService.generateEmbedding(query.trim());

      // Build search options from filters
      const searchOptions = {
        visibilityLevels: effectiveVisibilityLevels,
        contentTypes: normalizedFilters.contentTypes,
        tags: normalizedFilters.tags,
        badges: normalizedFilters.badges,
        dateRange: normalizedFilters.dateRange,
        limit: limit * 2, // Fetch more for merging
        offset: 0, // We'll handle pagination after merging
      };

      // Execute semantic and keyword searches in parallel
      const [semanticResults, keywordResults, totalCount] = await Promise.all([
        this.contentRepo.semanticSearch(queryEmbedding, searchOptions),
        this.contentRepo.keywordSearch(query.trim(), searchOptions),
        this.contentRepo.countSearchResults({
          visibilityLevels: effectiveVisibilityLevels,
          contentTypes: normalizedFilters.contentTypes,
          tags: normalizedFilters.tags,
          badges: normalizedFilters.badges,
          dateRange: normalizedFilters.dateRange,
        }),
      ]);

      // Merge and rank results using hybrid scoring
      const mergedResults = this.mergeAndRank(
        semanticResults as RankedContent[],
        keywordResults as RankedContent[],
        limit,
        offset
      );

      // Track analytics asynchronously
      this.trackSearchAnalytics(
        query,
        mergedResults.length,
        totalCount,
        Date.now() - startTime,
        isAuthenticated,
        userBadges.length
      ).catch(err => {
        console.warn('Failed to track search analytics:', err.message);
      });

      return {
        items: mergedResults,
        total: totalCount,
        limit,
        offset,
      };
    } catch (error: any) {
      // Track error in CloudWatch
      this.trackSearchError(query, error.message).catch(err => {
        console.warn('Failed to track search error:', err.message);
      });

      throw new InternalError(`Search failed: ${error.message}`, {
        originalError: error.message,
        query,
        filters
      });
    }
  }

  /**
   * Determine allowed visibility levels based on user authentication and badges
   *
   * @param isAuthenticated - Whether user is authenticated
   * @param userBadges - User's badges
   * @param isAwsEmployee - Whether user is an AWS employee
   * @returns Array of allowed visibility levels
   */
  private determineVisibility(
    isAuthenticated: boolean,
    userBadges: BadgeType[],
    isAwsEmployee: boolean
  ): Visibility[] {
    if (!isAuthenticated) {
      // Anonymous users can only see public content
      return [Visibility.PUBLIC];
    }

    const visibilityLevels: Visibility[] = [Visibility.PUBLIC];

    // Check for AWS Community badges
    const awsCommunityBadges = [
      BadgeType.COMMUNITY_BUILDER,
      BadgeType.HERO,
      BadgeType.AMBASSADOR,
      BadgeType.USER_GROUP_LEADER,
    ];

    const hasAwsCommunityBadge = userBadges.some(badge =>
      awsCommunityBadges.includes(badge)
    );

    if (hasAwsCommunityBadge) {
      visibilityLevels.push(Visibility.AWS_COMMUNITY);
    }

    // AWS_ONLY visibility requires isAwsEmployee flag
    // Only AWS employees can see AWS_ONLY content
    if (isAwsEmployee) {
      visibilityLevels.push(Visibility.AWS_ONLY);
    }

    return visibilityLevels;
  }

  /**
   * Merge and rank results from semantic and keyword searches
   * Uses weighted scoring: 70% semantic similarity + 30% keyword rank
   *
   * @param semanticResults - Results from vector similarity search
   * @param keywordResults - Results from full-text search
   * @param limit - Maximum results to return
   * @param offset - Pagination offset
   * @returns Merged and ranked content array
   */
  private mergeAndRank(
    semanticResults: RankedContent[],
    keywordResults: RankedContent[],
    limit: number,
    offset: number
  ): Content[] {
    // Create a map to combine scores for duplicates
    const contentMap = new Map<string, RankedContent>();

    // Normalize semantic scores to 0-1 range
    const maxSemantic = Math.max(...semanticResults.map(r => r.similarity || 0), 1);
    semanticResults.forEach(content => {
      const normalizedScore = (content.similarity || 0) / maxSemantic;
      const weightedScore = normalizedScore * this.SEMANTIC_WEIGHT;

      contentMap.set(content.id, {
        ...content,
        combinedScore: weightedScore,
      });
    });

    // Normalize keyword scores to 0-1 range and add to combined scores
    const maxKeyword = Math.max(...keywordResults.map(r => r.rank || 0), 1);
    keywordResults.forEach(content => {
      const normalizedScore = (content.rank || 0) / maxKeyword;
      const weightedScore = normalizedScore * this.KEYWORD_WEIGHT;

      const existing = contentMap.get(content.id);
      if (existing) {
        // Content found in both searches - combine scores
        existing.combinedScore = (existing.combinedScore || 0) + weightedScore;
      } else {
        // Content only in keyword search
        contentMap.set(content.id, {
          ...content,
          combinedScore: weightedScore,
        });
      }
    });

    // Sort by combined score descending
    const sortedResults = Array.from(contentMap.values())
      .sort((a, b) => (b.combinedScore || 0) - (a.combinedScore || 0));

    // Apply pagination and remove scoring metadata
    return sortedResults
      .slice(offset, offset + limit)
      .map(({ similarity, rank, combinedScore, ...content }) => content as Content);
  }

  /**
   * Track search analytics to CloudWatch
   *
   * @param query - Search query
   * @param resultCount - Number of results returned
   * @param totalMatches - Total matching items (before pagination)
   * @param latency - Search latency in milliseconds
   * @param isAuthenticated - Whether user was authenticated
   * @param badgeCount - Number of badges user has
   */
  private async trackSearchAnalytics(
    query: string,
    resultCount: number,
    totalMatches: number,
    latency: number,
    isAuthenticated: boolean,
    badgeCount: number
  ): Promise<void> {
    const namespace = 'CommunityContentHub/Search';
    const timestamp = new Date();

    const command = new PutMetricDataCommand({
      Namespace: namespace,
      MetricData: [
        {
          MetricName: 'SearchRequestCount',
          Value: 1,
          Unit: 'Count',
          Timestamp: timestamp,
          Dimensions: [
            { Name: 'SearchType', Value: 'Hybrid' },
            { Name: 'Authenticated', Value: isAuthenticated.toString() },
          ],
        },
        {
          MetricName: 'SearchLatency',
          Value: latency,
          Unit: 'Milliseconds',
          Timestamp: timestamp,
          Dimensions: [
            { Name: 'SearchType', Value: 'Hybrid' },
          ],
        },
        {
          MetricName: 'SearchResultCount',
          Value: resultCount,
          Unit: 'Count',
          Timestamp: timestamp,
          Dimensions: [
            { Name: 'SearchType', Value: 'Hybrid' },
          ],
        },
        {
          MetricName: 'SearchTotalMatches',
          Value: totalMatches,
          Unit: 'Count',
          Timestamp: timestamp,
          Dimensions: [
            { Name: 'SearchType', Value: 'Hybrid' },
          ],
        },
        {
          MetricName: 'SearchQueryLength',
          Value: query.length,
          Unit: 'Count',
          Timestamp: timestamp,
          Dimensions: [
            { Name: 'SearchType', Value: 'Hybrid' },
          ],
        },
        {
          MetricName: 'UserBadgeCount',
          Value: badgeCount,
          Unit: 'Count',
          Timestamp: timestamp,
          Dimensions: [
            { Name: 'Authenticated', Value: isAuthenticated.toString() },
          ],
        },
      ],
    });

    await this.cloudwatch.send(command);
  }

  /**
   * Track search errors to CloudWatch
   *
   * @param query - Search query that failed
   * @param errorMessage - Error message
   */
  private async trackSearchError(query: string, errorMessage: string): Promise<void> {
    const namespace = 'CommunityContentHub/Search';
    const timestamp = new Date();

    const command = new PutMetricDataCommand({
      Namespace: namespace,
      MetricData: [
        {
          MetricName: 'SearchErrorCount',
          Value: 1,
          Unit: 'Count',
          Timestamp: timestamp,
          Dimensions: [
            { Name: 'SearchType', Value: 'Hybrid' },
            { Name: 'ErrorType', Value: this.categorizeError(errorMessage) },
          ],
        },
      ],
    });

    await this.cloudwatch.send(command);
  }

  /**
   * Categorize error for CloudWatch dimensions
   *
   * @param errorMessage - Error message
   * @returns Error category
   */
  private categorizeError(errorMessage: string): string {
    const lowerMessage = errorMessage.toLowerCase();

    if (lowerMessage.includes('embedding')) return 'EmbeddingError';
    if (lowerMessage.includes('database') || lowerMessage.includes('query')) return 'DatabaseError';
    if (lowerMessage.includes('timeout')) return 'TimeoutError';
    if (lowerMessage.includes('throttl')) return 'ThrottlingError';

    return 'UnknownError';
  }
}

/**
 * Singleton instance for reuse across Lambda invocations
 */
let searchServiceInstance: SearchService | null = null;

/**
 * Get or create singleton SearchService instance
 *
 * @param contentRepo - Content repository instance
 * @param embeddingService - Embedding service instance
 * @param cloudwatch - CloudWatch client instance
 * @returns SearchService instance
 */
export function getSearchService(
  contentRepo?: ContentRepository,
  embeddingService?: EmbeddingService,
  cloudwatch?: CloudWatchClient
): SearchService {
  if (!searchServiceInstance && contentRepo && embeddingService && cloudwatch) {
    searchServiceInstance = new SearchService(contentRepo, embeddingService, cloudwatch);
  }

  if (!searchServiceInstance) {
    throw new Error('SearchService not initialized. Provide dependencies on first call.');
  }

  return searchServiceInstance;
}
