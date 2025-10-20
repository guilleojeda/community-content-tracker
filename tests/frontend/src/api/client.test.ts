import { Visibility, ContentType, BadgeType } from '@shared/types';
import { ApiClient, createApiClient, apiClient } from '@/api/client';

describe('ApiClient', () => {
  let client: ApiClient;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    client = new ApiClient({ baseUrl: 'http://localhost:3001' });
  });

  describe('advanced search', () => {
    it('should call advanced search endpoint with parameters', async () => {
      const apiResponse = {
        results: [
          {
            id: 'content-1',
            userId: 'user-1',
            title: 'Lambda Deep Dive',
            description: 'Serverless guide',
            contentType: ContentType.BLOG,
            visibility: Visibility.PUBLIC,
            publishDate: '2024-01-01T00:00:00.000Z',
            captureDate: '2024-01-02T00:00:00.000Z',
            metrics: { views: 42 },
            tags: ['aws', 'lambda'],
            url: 'https://example.com/lambda',
            isClaimed: true,
            originalAuthor: null,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
            relevanceScore: 0.92,
            author: {
              id: 'user-1',
              username: 'builder',
              email: 'builder@example.com',
              isAwsEmployee: true,
            },
          },
        ],
        count: 1,
        query: 'lambda',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true, data: apiResponse }),
      });

      const result = await client.advancedSearch({
        query: 'lambda',
        withinIds: ['content-1'],
        limit: 25,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/search/advanced?query=lambda&format=json&withinIds=content-1&limit=25',
        expect.objectContaining({
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        })
      );
      expect(result).toEqual(apiResponse);
    });

    it('should download advanced search CSV exports', async () => {
      const blob = new Blob(['csv']);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({
          'content-disposition': 'attachment; filename="search_results.csv"',
        }),
        blob: async () => blob,
      });

      const download = await client.exportAdvancedSearchCsv({
        query: 'lambda',
        withinIds: ['content-1', 'content-2'],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/search/advanced?query=lambda&format=csv&withinIds=content-1%2Ccontent-2',
        expect.objectContaining({
          method: 'GET',
        })
      );
      expect(download).toEqual({ blob, filename: 'search_results.csv' });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should use provided baseUrl', () => {
      const customClient = new ApiClient({ baseUrl: 'http://custom.url' });
      expect(customClient).toBeDefined();
    });

    it('should use default baseUrl when not provided', () => {
      const defaultClient = new ApiClient();
      expect(defaultClient).toBeDefined();
    });

    it('should accept getAuthToken function', () => {
      const getAuthToken = () => 'test-token';
      const customClient = new ApiClient({ getAuthToken });
      expect(customClient).toBeDefined();
    });

    it('should accept onError callback', () => {
      const onError = jest.fn();
      const customClient = new ApiClient({ onError });
      expect(customClient).toBeDefined();
    });

    it('should use environment baseUrl when config not provided', async () => {
      const originalEnv = process.env.NEXT_PUBLIC_API_URL;
      process.env.NEXT_PUBLIC_API_URL = 'https://env.example.com/';

      const envClient = new ApiClient();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ status: 'ok' }),
      });

      await (envClient as any).request('/health');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://env.example.com/health',
        expect.any(Object)
      );

      process.env.NEXT_PUBLIC_API_URL = originalEnv;
    });

    it('throws when baseUrl cannot be resolved', () => {
      const originalEnv = process.env.NEXT_PUBLIC_API_URL;
      delete process.env.NEXT_PUBLIC_API_URL;

      expect(() => new ApiClient()).toThrow('NEXT_PUBLIC_API_URL must be defined to use the API client');

      process.env.NEXT_PUBLIC_API_URL = originalEnv;
    });
  });

  describe('request method', () => {
    it('should make successful GET request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: 'test' }),
      });

      const result = await (client as any).request('/test');
      expect(result).toEqual({ data: 'test' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/test',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should add auth token when getAuthToken is provided', async () => {
      const clientWithAuth = new ApiClient({
        baseUrl: 'http://localhost:3001',
        getAuthToken: () => 'test-token',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: 'test' }),
      });

      await (clientWithAuth as any).request('/test');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/test',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
        })
      );
    });

    it('should handle async getAuthToken', async () => {
      const clientWithAuth = new ApiClient({
        baseUrl: 'http://localhost:3001',
        getAuthToken: async () => 'async-token',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: 'test' }),
      });

      await (clientWithAuth as any).request('/test');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/test',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer async-token',
          }),
        })
      );
    });

    it('should not add auth header when token is null', async () => {
      const clientWithAuth = new ApiClient({
        baseUrl: 'http://localhost:3001',
        getAuthToken: () => null,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: 'test' }),
      });

      await (clientWithAuth as any).request('/test');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/test',
        expect.objectContaining({
          headers: expect.not.objectContaining({
            'Authorization': expect.anything(),
          }),
        })
      );
    });

    it('should handle error responses with onError callback', async () => {
      const onError = jest.fn();
      const clientWithError = new ApiClient({
        baseUrl: 'http://localhost:3001',
        onError,
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: { code: 'TEST_ERROR', message: 'Test error message' },
        }),
      });

      await expect((clientWithError as any).request('/test')).rejects.toThrow('Test error message');
      expect(onError).toHaveBeenCalledWith({
        code: 'TEST_ERROR',
        message: 'Test error message',
      });
    });

    it('should handle error responses without onError callback', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: { code: 'TEST_ERROR', message: 'Test error message' },
        }),
      });

      await expect((client as any).request('/test')).rejects.toThrow('Test error message');
    });

    it('should throw generic error when error payload cannot be parsed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => {
          throw new Error('invalid json');
        },
      });

      await expect((client as any).request('/test')).rejects.toThrow('Request failed');
    });

    it('should handle empty responses (no JSON)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain' }),
        json: async () => ({}),
      });

      const result = await (client as any).request('/test');
      expect(result).toEqual({});
    });

    it('should handle responses without content-type header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        json: async () => ({}),
      });

      const result = await (client as any).request('/test');
      expect(result).toEqual({});
    });
  });

  describe('downloadFile helper', () => {
    it('throws error when download request fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: { message: 'Forbidden' },
        }),
      });

      await expect((client as any).downloadFile('/export')).rejects.toThrow('Forbidden');
    });

    it('returns null filename when content-disposition header is absent', async () => {
      const blob = new Blob(['data']);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        blob: async () => blob,
      });

      const result = await (client as any).downloadFile('/export');
      expect(result).toEqual({ blob, filename: null });
    });

    it('invokes configured onError handler when download fails', async () => {
      const onError = jest.fn();
      const clientWithErrorHandler = new ApiClient({
        baseUrl: 'http://localhost:3001',
        onError,
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: { code: 'EXPORT_FAILED', message: 'Failed export' },
        }),
      });

      await expect((clientWithErrorHandler as any).downloadFile('/export')).rejects.toThrow('Failed export');
      expect(onError).toHaveBeenCalledWith({ code: 'EXPORT_FAILED', message: 'Failed export' });
    });
  });

  describe('buildQueryString', () => {
    it('should build query string from parameters', () => {
      const result = (client as any).buildQueryString({ foo: 'bar', baz: 'qux' });
      expect(result).toBe('?foo=bar&baz=qux');
    });

    it('should return empty string when no parameters', () => {
      const result = (client as any).buildQueryString();
      expect(result).toBe('');
    });

    it('should skip undefined values', () => {
      const result = (client as any).buildQueryString({ foo: 'bar', baz: undefined });
      expect(result).toBe('?foo=bar');
    });

    it('should skip null values', () => {
      const result = (client as any).buildQueryString({ foo: 'bar', baz: null });
      expect(result).toBe('?foo=bar');
    });

    it('should convert values to strings', () => {
      const result = (client as any).buildQueryString({ foo: 123, bar: true });
      expect(result).toBe('?foo=123&bar=true');
    });

    it('should serialize search filters including arrays and date range', () => {
      const result = (client as any).buildQueryString({
        filters: {
          badges: [BadgeType.HERO],
          contentTypes: [ContentType.BLOG, ContentType.GITHUB],
          visibility: [Visibility.PUBLIC, Visibility.AWS_ONLY],
          tags: ['serverless', 'lambda'],
          dateRange: {
            start: new Date('2024-01-01'),
            end: new Date('2024-01-31'),
          },
        },
      });

      expect(result).toBe(
        '?badges=hero&type=blog%2Cgithub&visibility=public%2Caws_only&tags=serverless%2Clambda&startDate=2024-01-01&endDate=2024-01-31'
      );
    });

    it('serializes filter date range when only start date provided', () => {
      const result = (client as any).buildQueryString({
        filters: {
          dateRange: {
            start: new Date('2024-01-01'),
          },
        },
      });
      expect(result).toBe('?startDate=2024-01-01');
    });

    it('serializes filter date range when only end date provided', () => {
      const result = (client as any).buildQueryString({
        filters: {
          dateRange: {
            end: new Date('2024-01-31'),
          },
        },
      });
      expect(result).toBe('?endDate=2024-01-31');
    });

    it('formats ISO string dates in filter date range', () => {
      const result = (client as any).buildQueryString({
        filters: {
          dateRange: {
            start: '2024-01-05T10:00:00Z',
            end: '2024-01-10T10:00:00Z',
          },
        },
      });
      expect(result).toBe('?startDate=2024-01-05&endDate=2024-01-10');
    });

    it('should omit empty filter collections', () => {
      const result = (client as any).buildQueryString({
        filters: {
          badges: [],
          contentTypes: [],
          visibility: [],
          tags: [],
          dateRange: undefined,
        },
      });

      expect(result).toBe('');
    });

    it('serializes nested objects outside filters', () => {
      const result = (client as any).buildQueryString({
        paging: { limit: 10, offset: 5 },
      });
      expect(result).toBe('?paging%5Blimit%5D=10&paging%5Boffset%5D=5');
    });
  });

  describe('search', () => {
    it('should call search endpoint with query parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ results: [], total: 0 }),
      });

      await client.search({ q: 'test query', limit: 10 });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/search?q=test+query&limit=10',
        expect.any(Object)
      );
    });
  });

  describe('getStats', () => {
    it('should call stats endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ totalUsers: 100 }),
      });

      await client.getStats();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/stats',
        expect.any(Object)
      );
    });
  });

  describe('Authentication API', () => {
    it('should register user', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ userId: '123' }),
      });

      const result = await client.register({
        email: 'test@example.com',
        password: 'password123',
        username: 'testuser',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/auth/register',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            email: 'test@example.com',
            password: 'password123',
            username: 'testuser',
          }),
        })
      );
      expect(result).toEqual({ userId: '123' });
    });

    it('should login user', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ accessToken: 'token123' }),
      });

      const result = await client.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/auth/login',
        expect.objectContaining({ method: 'POST' })
      );
      expect(result).toEqual({ accessToken: 'token123' });
    });

    it('should verify email', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true }),
      });

      await client.verifyEmail({ token: 'verify-token' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/auth/verify-email',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should refresh token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ accessToken: 'new-token' }),
      });

      await client.refreshToken({ refreshToken: 'refresh-token' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/auth/refresh',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should request password reset', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'Email sent' }),
      });

      await client.forgotPassword({ email: 'test@example.com' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/auth/forgot-password',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should reset password', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'Password reset' }),
      });

      await client.resetPassword({
        email: 'test@example.com',
        confirmationCode: '123456',
        newPassword: 'newpass123',
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/auth/reset-password',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('Content API', () => {
    it('should get unclaimed content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ content: [], total: 0 }),
      });

      await client.getUnclaimedContent({ query: 'test', limit: 10 });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/content/unclaimed'),
        expect.any(Object)
      );
    });

    it('should claim content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true, content: {} }),
      });

      await client.claimContent('content-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/content/content-123/claim',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should bulk claim content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true, claimed: 2, failed: 0 }),
      });

      await client.bulkClaimContent(['id1', 'id2']);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/content/bulk-claim',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ contentIds: ['id1', 'id2'] }),
        })
      );
    });

    it('should list content with filters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ content: [], total: 0 }),
      });

      await client.listContent({
        contentType: 'blog',
        visibility: 'public',
        tags: ['aws', 'serverless'],
        limit: 20,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/content?'),
        expect.any(Object)
      );
    });

    it('should handle listContent with no parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ content: [], total: 0 }),
      });

      await client.listContent();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/content',
        expect.any(Object)
      );
    });

    it('should create content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ id: 'new-content' }),
      });

      await client.createContent({
        title: 'Test Content',
        contentType: 'blog',
        urls: ['https://example.com'],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/content',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should update content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ id: 'updated-content' }),
      });

      await client.updateContent('content-123', {
        title: 'Updated Title',
        visibility: 'public',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/content/content-123',
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('should delete content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true }),
      });

      await client.deleteContent('content-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/content/content-123',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should bulk update visibility', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ updated: 3 }),
      });

      await client.bulkUpdateVisibility(['id1', 'id2', 'id3'], 'private');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/content/bulk-update-visibility',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ contentIds: ['id1', 'id2', 'id3'], visibility: 'private' }),
        })
      );
    });

    it('should get content by ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ id: 'content-123', title: 'Test' }),
      });

      await client.getContent('content-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/content/content-123',
        expect.any(Object)
      );
    });

    it('should find duplicates', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ duplicates: [], similarity: [] }),
      });

      await client.findDuplicates({ threshold: 0.8, fields: ['title'] });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/content/duplicates'),
        expect.any(Object)
      );
    });

    it('should merge content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: true,
          mergedContentId: 'merged-123',
          mergeId: 'merge-456',
        }),
      });

      await client.mergeContent({
        primaryContentId: 'primary-123',
        mergedContentIds: ['dup1', 'dup2'],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/content/merge',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should unmerge content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: true,
          restoredContentIds: ['id1', 'id2'],
        }),
      });

      await client.unmergeContent('merge-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/content/merge/merge-123/undo',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should get merge history', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ merges: [], total: 0, hasMore: false }),
      });

      await client.getMergeHistory({ limit: 10, offset: 0 });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/content/merge-history'),
        expect.any(Object)
      );
    });
  });

  describe('Admin API', () => {
    it('normalizes admin dashboard stats response payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: true,
          data: {
            totalUsers: 42,
            awsEmployees: 5,
            totalContent: 123,
            usersByBadgeType: { hero: 2, ambassador: 1 },
            recentRegistrations: [
              {
                id: 'user-new',
                username: 'newbie',
                email: 'newbie@example.com',
                createdAt: '2024-02-01T00:00:00.000Z',
              },
            ],
            pendingBadgeCandidates: [
              {
                id: 'user-candidate',
                username: 'candidate',
                email: 'candidate@example.com',
                createdAt: '2024-01-28T00:00:00.000Z',
                contentCount: 5,
              },
            ],
            quickActions: {
              flaggedContentCount: 1,
              recentAdminActions: 2,
              usersWithoutBadges: 3,
              contentNeedingReview: 4,
            },
          },
        }),
      });

      const stats = await client.getAdminDashboardStats();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/admin/dashboard/stats',
        expect.any(Object)
      );
      expect(stats.usersByBadgeType.hero).toBe(2);
      expect(stats.recentRegistrations[0].createdAt).toBeInstanceOf(Date);
      expect(stats.pendingBadgeCandidates[0].createdAt).toBeInstanceOf(Date);
    });

    it('returns flagged content when response omits data wrapper', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          content: [
            {
              id: 'content-flagged',
              title: 'Flagged post',
              description: 'Needs review',
              visibility: Visibility.PUBLIC,
              flagReason: 'Spam',
              flaggedAt: '2024-02-10T00:00:00.000Z',
              moderationStatus: 'flagged',
              user: {
                id: 'author-1',
                username: 'author',
                email: 'author@example.com',
              },
            },
          ],
          total: 1,
          limit: 10,
          offset: 0,
        }),
      });

      const response = await client.listFlaggedContent({ limit: 10 });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/admin/content/flagged?limit=10',
        expect.any(Object)
      );
      expect(response.content).toHaveLength(1);
      expect(response.total).toBe(1);
    });

    it('maps flagged content when data wrapper is provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: true,
          data: {
            content: [
              {
                id: 'content-flagged',
                title: 'Flagged post',
                description: 'Needs review',
                visibility: Visibility.PUBLIC,
                flagReason: 'Spam',
                flaggedAt: '2024-02-10T00:00:00.000Z',
                moderationStatus: 'flagged',
                user: {
                  id: 'author-1',
                  username: 'author',
                  email: 'author@example.com',
                },
              },
            ],
            total: 1,
            limit: 10,
            offset: 0,
          },
        }),
      });

      const response = await client.listFlaggedContent();
      expect(response.content[0].title).toBe('Flagged post');
      expect(response.total).toBe(1);
    });

    it('downloads program export CSV files', async () => {
      const blob = new Blob(['program']);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-disposition': 'attachment; filename="hero_export.csv"' }),
        blob: async () => blob,
      });

      const download = await client.exportProgramCsv({
        programType: 'hero',
        startDate: '2024-01-01',
        endDate: '2024-02-01',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/export/csv',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            programType: 'hero',
            startDate: '2024-01-01',
            endDate: '2024-02-01',
          }),
        })
      );
      expect(download).toEqual({ blob, filename: 'hero_export.csv' });
    });

    it('returns export history with defaulted values', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: true,
          data: {
            history: [
              {
                id: 'history-1',
                exportType: 'program',
                exportFormat: 'community_builder',
                rowCount: null,
                createdAt: '2024-02-03T00:00:00.000Z',
                parameters: {},
              },
            ],
            total: null,
            limit: null,
            offset: null,
          },
        }),
      });

      const history = await client.getExportHistory();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/export/history',
        expect.any(Object)
      );
      expect(history.history).toHaveLength(1);
      expect(history.total).toBe(1);
      expect(history.limit).toBe(1);
      expect(history.offset).toBe(0);
    });

    it('posts analytics events payloads to tracking endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true }),
      });

    await client.trackAnalyticsEvents({ eventType: 'page_view', metadata: { page: '/admin' } });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/analytics/track',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ eventType: 'page_view', metadata: { page: '/admin' } }),
        })
      );
    });

    it('returns admin system health data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: true,
          data: {
            database: 'healthy',
            timestamp: new Date().toISOString(),
          },
        }),
      });

      const health = await client.getAdminSystemHealth();
      expect(health.database).toBe('healthy');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/admin/dashboard/system-health',
        expect.any(Object)
      );
    });

  describe('Analytics and saved search API', () => {
    it('handles analytics exports and saved search lifecycle', async () => {
      const analyticsBlob = new Blob(['analytics']);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: true,
            data: {
              contentByType: { blog: 2 },
              topTags: [],
              topContent: [],
              timeSeries: [],
              dateRange: null,
              groupBy: 'day',
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-disposition': 'attachment; filename="analytics.csv"' }),
          blob: async () => analyticsBlob,
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: true,
            data: {
              searches: [],
              count: 0,
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: true,
            data: {
              id: 'saved-1',
              userId: 'user-1',
              name: 'search',
              query: 'aws',
              filters: {},
              isPublic: false,
              createdAt: '2024-02-01T00:00:00.000Z',
              updatedAt: '2024-02-01T00:00:00.000Z',
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: true,
            data: {
              id: 'saved-1',
              userId: 'user-1',
              name: 'search-updated',
              query: 'aws updated',
              filters: {},
              isPublic: false,
              createdAt: '2024-02-01T00:00:00.000Z',
              updatedAt: '2024-02-02T00:00:00.000Z',
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers(),
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: true,
            data: {
              id: 'saved-1',
              userId: 'user-1',
              name: 'search-updated',
              query: 'aws updated',
              filters: {},
              isPublic: false,
              createdAt: '2024-02-01T00:00:00.000Z',
              updatedAt: '2024-02-02T00:00:00.000Z',
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: true,
            data: { message: 'Preferences updated' },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: true,
            data: {
              user: { id: 'user-1' },
              content: [],
              badges: [],
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: true,
            data: { message: 'Account deleted' },
          }),
        });

      await client.getUserAnalytics({ groupBy: 'week' });
      const analyticsDownload = await client.exportAnalyticsCsv({ groupBy: 'month' });
      expect(analyticsDownload.filename).toBe('analytics.csv');

      await client.getSavedSearches();
      await client.saveSearch({ name: 'search', query: 'aws' });
      await client.updateSavedSearch('saved-1', { query: 'aws updated' });
      await client.deleteSavedSearch('saved-1');
      await client.getSavedSearch('saved-1');

      await client.updatePreferences('user-1', { receiveNewsletter: true });
      await client.exportUserData('user-1');
      await client.deleteAccount('user-1');

      expect(mockFetch).toHaveBeenCalledTimes(10);
    });
  });

    it('performs badge and audit-log administrative operations', async () => {
      const userExportBlob = new Blob(['users']);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: true,
            data: {
              users: [],
              total: 0,
              limit: 25,
              offset: 0,
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: true,
            data: {
              user: {
                id: 'admin-1',
                username: 'admin',
                email: 'admin@example.com',
                isAdmin: true,
                isAwsEmployee: true,
                createdAt: '2024-01-01T00:00:00.000Z',
              },
              badges: [],
              contentCount: 0,
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-disposition': 'attachment; filename="users.csv"' }),
          blob: async () => userExportBlob,
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ success: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ success: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: true,
            data: {
              summary: { successful: 2, failed: [] },
              failed: [],
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ success: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: true,
            data: {
              entries: [],
              pagination: { total: 0, hasMore: false },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ success: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ success: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ success: true }),
        });

      await client.listAdminUsers({ search: 'admin', badgeType: BadgeType.HERO, limit: 25, offset: 0 });
      await client.getAdminUser('admin-1');
      const csv = await client.exportUsersCsv();
      expect(csv).toEqual({ blob: userExportBlob, filename: 'users.csv' });
      await client.grantBadge({ userId: 'user-1', badgeType: BadgeType.HERO });
      await client.revokeBadge({ userId: 'user-1', badgeType: BadgeType.HERO });
      await client.bulkBadges({ operation: 'grant', userIds: ['user-1', 'user-2'], badgeType: BadgeType.AMBASSADOR });
      await client.setAwsEmployee('user-1', { isAwsEmployee: true, reason: 'Verified domain' });
      await client.listAuditLog({ actionType: 'grant_badge', limit: 10, offset: 0 });
      await client.flagContent('content-1', 'spam');
      await client.moderateContent('content-1', 'approve');
      await client.adminDeleteContent('content-1', 'duplicate');

      expect(mockFetch).toHaveBeenCalledTimes(11);
    });
  });

  describe('User Profile API', () => {
    it('should get current user', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ id: 'user-123', username: 'testuser' }),
      });

      await client.getCurrentUser();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/users/me',
        expect.any(Object)
      );
    });

    it('should get user badges', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ([{ id: 'badge-1', type: 'hero' }]),
      });

      await client.getUserBadges();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/users/me/badges',
        expect.any(Object)
      );
    });

    it('should update user profile', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ id: 'user-123', username: 'newusername' }),
      });

      await client.updateUserProfile('user-123', {
        username: 'newusername',
        defaultVisibility: Visibility.PUBLIC,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/users/user-123',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            username: 'newusername',
            defaultVisibility: Visibility.PUBLIC,
          }),
        })
      );
    });
  });

  describe('Factory functions', () => {
    it('should create API client with createApiClient', () => {
      const newClient = createApiClient({ baseUrl: 'http://test.com' });
      expect(newClient).toBeInstanceOf(ApiClient);
    });

    it('should export default apiClient instance', () => {
      expect(apiClient).toBeInstanceOf(ApiClient);
    });
  });
});
