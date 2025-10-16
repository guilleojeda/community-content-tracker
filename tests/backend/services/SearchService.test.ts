import { SearchService, SearchResult } from '../../../src/backend/services/SearchService';
import { ContentRepository } from '../../../src/backend/repositories/ContentRepository';
import { EmbeddingService } from '../../../src/backend/services/EmbeddingService';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { SearchRequest, Content, Visibility, ContentType, BadgeType } from '../../../src/shared/types';

// Mock AWS SDK clients
jest.mock('@aws-sdk/client-cloudwatch');

describe('SearchService', () => {
  let searchService: SearchService;
  let mockContentRepo: jest.Mocked<ContentRepository>;
  let mockEmbeddingService: jest.Mocked<EmbeddingService>;
  let mockCloudWatch: jest.Mocked<CloudWatchClient>;

  // Sample test data
  const mockEmbedding = new Array(1536).fill(0).map((_, i) => i / 1536);
  const mockContent1: Content = {
    id: 'content-1',
    userId: 'user-1',
    title: 'AWS Lambda Best Practices',
    description: 'Learn serverless development with AWS Lambda',
    contentType: ContentType.BLOG,
    visibility: Visibility.PUBLIC,
    publishDate: new Date('2024-01-01'),
    captureDate: new Date('2024-01-02'),
    metrics: {},
    tags: ['aws', 'lambda', 'serverless'],
    isClaimed: true,
    urls: [],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const mockContent2: Content = {
    id: 'content-2',
    userId: 'user-2',
    title: 'Serverless Architecture Guide',
    description: 'Building scalable serverless applications',
    contentType: ContentType.YOUTUBE,
    visibility: Visibility.AWS_COMMUNITY,
    publishDate: new Date('2024-01-05'),
    captureDate: new Date('2024-01-06'),
    metrics: {},
    tags: ['serverless', 'architecture', 'aws'],
    isClaimed: true,
    urls: [],
    createdAt: new Date('2024-01-05'),
    updatedAt: new Date('2024-01-05'),
  };

  const mockContent3: Content = {
    id: 'content-3',
    userId: 'user-3',
    title: 'AWS Internal Documentation',
    description: 'Internal AWS documentation',
    contentType: ContentType.BLOG,
    visibility: Visibility.AWS_ONLY,
    publishDate: new Date('2024-01-10'),
    captureDate: new Date('2024-01-11'),
    metrics: {},
    tags: ['aws', 'documentation'],
    isClaimed: false,
    urls: [],
    createdAt: new Date('2024-01-10'),
    updatedAt: new Date('2024-01-10'),
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock instances
    mockContentRepo = {
      semanticSearch: jest.fn(),
      keywordSearch: jest.fn(),
      countSearchResults: jest.fn(),
    } as unknown as jest.Mocked<ContentRepository>;

    mockEmbeddingService = {
      generateEmbedding: jest.fn(),
    } as unknown as jest.Mocked<EmbeddingService>;

    mockCloudWatch = {
      send: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CloudWatchClient>;

    // Create service instance
    searchService = new SearchService(mockContentRepo, mockEmbeddingService, mockCloudWatch);
  });

  describe('search', () => {
    it('should return empty results for empty query', async () => {
      const request: SearchRequest = {
        query: '',
        limit: 20,
        offset: 0,
      };

      const result = await searchService.search(request, false);

      expect(result).toEqual({
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      });
      expect(mockEmbeddingService.generateEmbedding).not.toHaveBeenCalled();
    });

    it('should perform hybrid search for authenticated user', async () => {
      const request: SearchRequest = {
        query: 'AWS Lambda serverless',
        limit: 10,
        offset: 0,
      };

      // Mock embedding generation
      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);

      // Mock semantic search results
      mockContentRepo.semanticSearch.mockResolvedValue([
        { ...mockContent1, similarity: 0.95 },
        { ...mockContent2, similarity: 0.85 },
      ] as any);

      // Mock keyword search results
      mockContentRepo.keywordSearch.mockResolvedValue([
        { ...mockContent1, rank: 0.9 },
        { ...mockContent2, rank: 0.7 },
      ] as any);

      // Mock count
      mockContentRepo.countSearchResults.mockResolvedValue(2);

      const result = await searchService.search(request, true, []);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);

      expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith('AWS Lambda serverless');
      expect(mockContentRepo.semanticSearch).toHaveBeenCalled();
      expect(mockContentRepo.keywordSearch).toHaveBeenCalled();
      expect(mockContentRepo.countSearchResults).toHaveBeenCalled();
    });

    it('should filter by visibility for anonymous user', async () => {
      const request: SearchRequest = {
        query: 'AWS',
        limit: 20,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockContentRepo.semanticSearch.mockResolvedValue([{ ...mockContent1, similarity: 0.9 }] as any);
      mockContentRepo.keywordSearch.mockResolvedValue([{ ...mockContent1, rank: 0.8 }] as any);
      mockContentRepo.countSearchResults.mockResolvedValue(1);

      await searchService.search(request, false);

      // Should only allow PUBLIC visibility for anonymous users
      const semanticCall = mockContentRepo.semanticSearch.mock.calls[0];
      expect(semanticCall[1].visibilityLevels).toEqual([Visibility.PUBLIC]);

      const keywordCall = mockContentRepo.keywordSearch.mock.calls[0];
      expect(keywordCall[1].visibilityLevels).toEqual([Visibility.PUBLIC]);
    });

    it('should allow AWS_COMMUNITY visibility for user with community badges', async () => {
      const request: SearchRequest = {
        query: 'AWS',
        limit: 20,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockContentRepo.semanticSearch.mockResolvedValue([]);
      mockContentRepo.keywordSearch.mockResolvedValue([]);
      mockContentRepo.countSearchResults.mockResolvedValue(0);

      await searchService.search(request, true, [BadgeType.COMMUNITY_BUILDER]);

      const semanticCall = mockContentRepo.semanticSearch.mock.calls[0];
      expect(semanticCall[1].visibilityLevels).toContain(Visibility.PUBLIC);
      expect(semanticCall[1].visibilityLevels).toContain(Visibility.AWS_COMMUNITY);
    });

    it('should apply content type filters', async () => {
      const request: SearchRequest = {
        query: 'AWS',
        filters: {
          contentTypes: [ContentType.BLOG, ContentType.YOUTUBE],
        },
        limit: 20,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockContentRepo.semanticSearch.mockResolvedValue([]);
      mockContentRepo.keywordSearch.mockResolvedValue([]);
      mockContentRepo.countSearchResults.mockResolvedValue(0);

      await searchService.search(request, false);

      const semanticCall = mockContentRepo.semanticSearch.mock.calls[0];
      expect(semanticCall[1].contentTypes).toEqual([ContentType.BLOG, ContentType.YOUTUBE]);
    });

    it('should apply tag filters', async () => {
      const request: SearchRequest = {
        query: 'AWS',
        filters: {
          tags: ['serverless', 'lambda'],
        },
        limit: 20,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockContentRepo.semanticSearch.mockResolvedValue([]);
      mockContentRepo.keywordSearch.mockResolvedValue([]);
      mockContentRepo.countSearchResults.mockResolvedValue(0);

      await searchService.search(request, false);

      const semanticCall = mockContentRepo.semanticSearch.mock.calls[0];
      expect(semanticCall[1].tags).toEqual(['serverless', 'lambda']);
    });

    it('should apply date range filters', async () => {
      const dateRange = {
        start: new Date('2024-01-01'),
        end: new Date('2024-12-31'),
      };

      const request: SearchRequest = {
        query: 'AWS',
        filters: {
          dateRange,
        },
        limit: 20,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockContentRepo.semanticSearch.mockResolvedValue([]);
      mockContentRepo.keywordSearch.mockResolvedValue([]);
      mockContentRepo.countSearchResults.mockResolvedValue(0);

      await searchService.search(request, false);

      const semanticCall = mockContentRepo.semanticSearch.mock.calls[0];
      expect(semanticCall[1].dateRange).toEqual(dateRange);
    });

    it('should apply badge filters', async () => {
      const request: SearchRequest = {
        query: 'AWS',
        filters: {
          badges: [BadgeType.HERO, BadgeType.AMBASSADOR],
        },
        limit: 20,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockContentRepo.semanticSearch.mockResolvedValue([]);
      mockContentRepo.keywordSearch.mockResolvedValue([]);
      mockContentRepo.countSearchResults.mockResolvedValue(0);

      await searchService.search(request, false);

      const semanticCall = mockContentRepo.semanticSearch.mock.calls[0];
      expect(semanticCall[1].badges).toEqual([BadgeType.HERO, BadgeType.AMBASSADOR]);
    });

    it('should return empty results when requested visibility is not permitted', async () => {
      const request: SearchRequest = {
        query: 'AWS',
        filters: {
          visibility: [Visibility.AWS_ONLY],
        },
        limit: 20,
        offset: 0,
      };

      const result = await searchService.search(request, false);

      expect(result).toEqual({
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      });
      expect(mockEmbeddingService.generateEmbedding).not.toHaveBeenCalled();
      expect(mockContentRepo.semanticSearch).not.toHaveBeenCalled();
      expect(mockContentRepo.keywordSearch).not.toHaveBeenCalled();
      expect(mockContentRepo.countSearchResults).not.toHaveBeenCalled();
    });

    it('should honor requested visibility subset when permitted', async () => {
      const request: SearchRequest = {
        query: 'AWS',
        filters: {
          visibility: [Visibility.PUBLIC],
        },
        limit: 20,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockContentRepo.semanticSearch.mockResolvedValue([]);
      mockContentRepo.keywordSearch.mockResolvedValue([]);
      mockContentRepo.countSearchResults.mockResolvedValue(0);

      await searchService.search(request, true, [BadgeType.HERO], true);

      const semanticCall = mockContentRepo.semanticSearch.mock.calls[0];
      const keywordCall = mockContentRepo.keywordSearch.mock.calls[0];
      const countCall = mockContentRepo.countSearchResults.mock.calls[0];

      expect(semanticCall[1].visibilityLevels).toEqual([Visibility.PUBLIC]);
      expect(keywordCall[1].visibilityLevels).toEqual([Visibility.PUBLIC]);
      expect(countCall[0].visibilityLevels).toEqual([Visibility.PUBLIC]);
    });

    it('should handle pagination correctly', async () => {
      const request: SearchRequest = {
        query: 'AWS',
        limit: 5,
        offset: 10,
      };

      const mockResults = Array.from({ length: 20 }, (_, i) => ({
        ...mockContent1,
        id: `content-${i}`,
        similarity: 0.9 - i * 0.01,
      }));

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockContentRepo.semanticSearch.mockResolvedValue(mockResults as any);
      mockContentRepo.keywordSearch.mockResolvedValue(mockResults as any);
      mockContentRepo.countSearchResults.mockResolvedValue(20);

      const result = await searchService.search(request, false);

      expect(result.limit).toBe(5);
      expect(result.offset).toBe(10);
      expect(result.items.length).toBeLessThanOrEqual(5);
    });

    it('should merge results from semantic and keyword searches', async () => {
      const request: SearchRequest = {
        query: 'AWS Lambda',
        limit: 10,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);

      // Semantic search returns content-1 and content-2
      mockContentRepo.semanticSearch.mockResolvedValue([
        { ...mockContent1, similarity: 0.95 },
        { ...mockContent2, similarity: 0.85 },
      ] as any);

      // Keyword search returns content-1 and content-3
      mockContentRepo.keywordSearch.mockResolvedValue([
        { ...mockContent1, rank: 0.9 },
        { ...mockContent3, rank: 0.7 },
      ] as any);

      mockContentRepo.countSearchResults.mockResolvedValue(3);

      const result = await searchService.search(request, true, [BadgeType.COMMUNITY_BUILDER]);

      // Should return all 3 unique items
      expect(result.items.length).toBe(3);

      // content-1 should be ranked highest (in both searches)
      expect(result.items[0].id).toBe('content-1');
    });

    it('should track analytics to CloudWatch', async () => {
      const request: SearchRequest = {
        query: 'AWS Lambda',
        limit: 10,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockContentRepo.semanticSearch.mockResolvedValue([{ ...mockContent1, similarity: 0.9 }] as any);
      mockContentRepo.keywordSearch.mockResolvedValue([{ ...mockContent1, rank: 0.8 }] as any);
      mockContentRepo.countSearchResults.mockResolvedValue(1);

      await searchService.search(request, true, [BadgeType.HERO]);

      // Wait for async CloudWatch call
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockCloudWatch.send).toHaveBeenCalled();
      const cloudWatchCalls = (mockCloudWatch.send as jest.Mock).mock.calls;
      expect(cloudWatchCalls.length).toBeGreaterThan(0);
    });

    it('should handle embedding generation errors', async () => {
      const request: SearchRequest = {
        query: 'AWS Lambda',
        limit: 10,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockRejectedValue(
        new Error('Bedrock service unavailable')
      );

      await expect(searchService.search(request, false)).rejects.toThrow('Search failed');
    });

    it('should handle database query errors', async () => {
      const request: SearchRequest = {
        query: 'AWS Lambda',
        limit: 10,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockContentRepo.semanticSearch.mockRejectedValue(new Error('Database connection failed'));

      await expect(searchService.search(request, false)).rejects.toThrow('Search failed');
    });

    it('should apply 70-30 weighting to semantic and keyword scores', async () => {
      const request: SearchRequest = {
        query: 'AWS',
        limit: 10,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);

      // Content-1: High semantic, low keyword
      // Content-2: Low semantic, high keyword
      mockContentRepo.semanticSearch.mockResolvedValue([
        { ...mockContent1, similarity: 1.0 }, // Normalized: 1.0 * 0.7 = 0.7
        { ...mockContent2, similarity: 0.5 }, // Normalized: 0.5 * 0.7 = 0.35
      ] as any);

      mockContentRepo.keywordSearch.mockResolvedValue([
        { ...mockContent1, rank: 0.3 }, // Normalized: 0.3 * 0.3 = 0.09
        { ...mockContent2, rank: 1.0 }, // Normalized: 1.0 * 0.3 = 0.3
      ] as any);

      mockContentRepo.countSearchResults.mockResolvedValue(2);

      const result = await searchService.search(request, false);

      // Content-1 total score: 0.7 + 0.09 = 0.79
      // Content-2 total score: 0.35 + 0.3 = 0.65
      // Content-1 should be ranked first
      expect(result.items[0].id).toBe('content-1');
      expect(result.items[1].id).toBe('content-2');
    });

    it('should handle all badge types for visibility', async () => {
      const badgeTypes = [
        BadgeType.COMMUNITY_BUILDER,
        BadgeType.HERO,
        BadgeType.AMBASSADOR,
        BadgeType.USER_GROUP_LEADER,
      ];

      for (const badge of badgeTypes) {
        const request: SearchRequest = {
          query: 'AWS',
          limit: 10,
          offset: 0,
        };

        mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
        mockContentRepo.semanticSearch.mockResolvedValue([]);
        mockContentRepo.keywordSearch.mockResolvedValue([]);
        mockContentRepo.countSearchResults.mockResolvedValue(0);

        await searchService.search(request, true, [badge]);

        const semanticCall = mockContentRepo.semanticSearch.mock.calls[0];
        expect(semanticCall[1].visibilityLevels).toContain(Visibility.AWS_COMMUNITY);
      }
    });

    it('should handle combined filters correctly', async () => {
      const request: SearchRequest = {
        query: 'AWS Lambda serverless',
        filters: {
          contentTypes: [ContentType.BLOG],
          tags: ['aws', 'lambda'],
          badges: [BadgeType.HERO],
          dateRange: {
            start: new Date('2024-01-01'),
            end: new Date('2024-12-31'),
          },
        },
        limit: 20,
        offset: 5,
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockContentRepo.semanticSearch.mockResolvedValue([]);
      mockContentRepo.keywordSearch.mockResolvedValue([]);
      mockContentRepo.countSearchResults.mockResolvedValue(0);

      await searchService.search(request, true, [BadgeType.COMMUNITY_BUILDER]);

      const semanticCall = mockContentRepo.semanticSearch.mock.calls[0];
      expect(semanticCall[1].contentTypes).toEqual([ContentType.BLOG]);
      expect(semanticCall[1].tags).toEqual(['aws', 'lambda']);
      expect(semanticCall[1].badges).toEqual([BadgeType.HERO]);
      expect(semanticCall[1].dateRange).toBeDefined();
    });

    it('should deduplicate results appearing in both searches', async () => {
      const request: SearchRequest = {
        query: 'AWS',
        limit: 10,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);

      // Same content in both searches
      mockContentRepo.semanticSearch.mockResolvedValue([
        { ...mockContent1, similarity: 0.9 },
      ] as any);

      mockContentRepo.keywordSearch.mockResolvedValue([
        { ...mockContent1, rank: 0.8 },
      ] as any);

      mockContentRepo.countSearchResults.mockResolvedValue(1);

      const result = await searchService.search(request, false);

      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe('content-1');
    });

    it('should respect limit even with many results', async () => {
      const request: SearchRequest = {
        query: 'AWS',
        limit: 5,
        offset: 0,
      };

      const manyResults = Array.from({ length: 50 }, (_, i) => ({
        ...mockContent1,
        id: `content-${i}`,
        similarity: 0.9 - i * 0.01,
      }));

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockContentRepo.semanticSearch.mockResolvedValue(manyResults as any);
      mockContentRepo.keywordSearch.mockResolvedValue(manyResults as any);
      mockContentRepo.countSearchResults.mockResolvedValue(50);

      const result = await searchService.search(request, false);

      expect(result.items.length).toBe(5);
      expect(result.total).toBe(50);
    });
  });

  describe('error handling', () => {
    it('should track errors to CloudWatch', async () => {
      const request: SearchRequest = {
        query: 'AWS',
        limit: 10,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockRejectedValue(
        new Error('Embedding service error')
      );

      await expect(searchService.search(request, false)).rejects.toThrow();

      // Wait for async CloudWatch call
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockCloudWatch.send).toHaveBeenCalled();
    });

    it('should categorize embedding errors correctly', async () => {
      const request: SearchRequest = {
        query: 'AWS',
        limit: 10,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockRejectedValue(
        new Error('Failed to generate embedding')
      );

      await expect(searchService.search(request, false)).rejects.toThrow();

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify CloudWatch was called for error tracking
      expect(mockCloudWatch.send).toHaveBeenCalled();
    });

    it('should not fail if CloudWatch tracking fails', async () => {
      const request: SearchRequest = {
        query: 'AWS',
        limit: 10,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockContentRepo.semanticSearch.mockResolvedValue([]);
      mockContentRepo.keywordSearch.mockResolvedValue([]);
      mockContentRepo.countSearchResults.mockResolvedValue(0);
      (mockCloudWatch.send as jest.Mock).mockRejectedValueOnce(new Error('CloudWatch unavailable'));

      // Should not throw despite CloudWatch failure
      const result = await searchService.search(request, false);

      expect(result).toBeDefined();
      expect(result.items).toEqual([]);
    });
  });

  describe('visibility determination', () => {
    it('should allow only PUBLIC for anonymous users', async () => {
      const request: SearchRequest = {
        query: 'test',
        limit: 10,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockContentRepo.semanticSearch.mockResolvedValue([]);
      mockContentRepo.keywordSearch.mockResolvedValue([]);
      mockContentRepo.countSearchResults.mockResolvedValue(0);

      await searchService.search(request, false, []);

      const semanticCall = mockContentRepo.semanticSearch.mock.calls[0];
      expect(semanticCall[1].visibilityLevels).toEqual([Visibility.PUBLIC]);
    });

    it('should allow PUBLIC for authenticated users without badges', async () => {
      const request: SearchRequest = {
        query: 'test',
        limit: 10,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockContentRepo.semanticSearch.mockResolvedValue([]);
      mockContentRepo.keywordSearch.mockResolvedValue([]);
      mockContentRepo.countSearchResults.mockResolvedValue(0);

      await searchService.search(request, true, []);

      const semanticCall = mockContentRepo.semanticSearch.mock.calls[0];
      expect(semanticCall[1].visibilityLevels).toEqual([Visibility.PUBLIC]);
    });

    it('should allow AWS_COMMUNITY for users with appropriate badges', async () => {
      const request: SearchRequest = {
        query: 'test',
        limit: 10,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockContentRepo.semanticSearch.mockResolvedValue([]);
      mockContentRepo.keywordSearch.mockResolvedValue([]);
      mockContentRepo.countSearchResults.mockResolvedValue(0);

      await searchService.search(request, true, [BadgeType.AMBASSADOR], false);

      const semanticCall = mockContentRepo.semanticSearch.mock.calls[0];
      expect(semanticCall[1].visibilityLevels).toContain(Visibility.PUBLIC);
      expect(semanticCall[1].visibilityLevels).toContain(Visibility.AWS_COMMUNITY);
      expect(semanticCall[1].visibilityLevels).not.toContain(Visibility.AWS_ONLY);
    });

    it('should allow AWS_ONLY for AWS employees only', async () => {
      const request: SearchRequest = {
        query: 'test',
        limit: 10,
        offset: 0,
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockContentRepo.semanticSearch.mockResolvedValue([]);
      mockContentRepo.keywordSearch.mockResolvedValue([]);
      mockContentRepo.countSearchResults.mockResolvedValue(0);

      // AWS employee should see AWS_ONLY content
      await searchService.search(request, true, [BadgeType.HERO], true);

      const semanticCall = mockContentRepo.semanticSearch.mock.calls[0];
      expect(semanticCall[1].visibilityLevels).toContain(Visibility.PUBLIC);
      expect(semanticCall[1].visibilityLevels).toContain(Visibility.AWS_COMMUNITY);
      expect(semanticCall[1].visibilityLevels).toContain(Visibility.AWS_ONLY);
    });
  });
});
