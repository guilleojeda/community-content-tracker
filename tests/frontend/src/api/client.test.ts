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
