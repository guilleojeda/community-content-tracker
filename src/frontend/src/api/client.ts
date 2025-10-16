/**
 * Typed API client for AWS Community Content Hub
 * Generated from OpenAPI specification
 */
import type { paths } from './schema';
import type {
  Content,
  ApiError,
  ApiErrorResponse,
  SearchFilters,
  Visibility,
  BadgeType,
  ContentType,
  Channel,
  CreateChannelRequest,
  UpdateChannelRequest,
  ChannelListResponse,
  TriggerSyncResponse,
  User,
  Badge,
  UpdateUserRequest,
  ChangePasswordRequest,
  ChangePasswordResponse,
  MfaSetupResponse,
  UpdatePreferencesRequest,
  UpdatePreferencesResponse,
  UserDataExport,
  DeleteAccountResponse,
} from '@shared/types';

export type { ApiError, ApiErrorResponse } from '@shared/types';

/**
 * Extract response type from OpenAPI path
 */
type ApiResponse<T extends keyof paths, M extends keyof paths[T]> =
  paths[T][M] extends { responses: { 200: { content: { 'application/json': infer R } } } }
    ? R
    : never;

/**
 * Extract request body type from OpenAPI path
 */
type ApiRequestBody<T extends keyof paths, M extends keyof paths[T]> =
  paths[T][M] extends { requestBody: { content: { 'application/json': infer R } } }
    ? R
    : never;

/**
 * Extract query parameters type from OpenAPI path
 */
type ApiQueryParams<T extends keyof paths, M extends keyof paths[T]> =
  paths[T][M] extends { parameters: { query: infer Q } }
    ? Q
    : never;

/**
 * API client configuration
 */
export interface ApiClientConfig {
  baseUrl?: string;
  getAuthToken?: () => string | null | Promise<string | null>;
  onError?: (error: ApiError) => void;
}

function sanitizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '');
}

function resolveBaseUrl(configBaseUrl?: string): string {
  if (configBaseUrl && configBaseUrl.trim() !== '') {
    return sanitizeBaseUrl(configBaseUrl);
  }

  const envBaseUrl = process.env.NEXT_PUBLIC_API_URL;

  if (envBaseUrl && envBaseUrl.trim() !== '') {
    return sanitizeBaseUrl(envBaseUrl);
  }

  throw new Error('NEXT_PUBLIC_API_URL must be defined to use the API client');
}

/**
 * Typed API client
 */
export class ApiClient {
  private baseUrl: string;
  private getAuthToken?: () => string | null | Promise<string | null>;
  private onError?: (error: ApiError) => void;

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = resolveBaseUrl(config.baseUrl);
    this.getAuthToken = config.getAuthToken;
    this.onError = config.onError;
  }

  /**
   * Make authenticated request
   */
  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    // Add authentication token if available
    if (this.getAuthToken) {
      const token = await this.getAuthToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    // Handle error responses
    if (!response.ok) {
      const errorData: ApiErrorResponse = await response.json();
      if (this.onError) {
        this.onError(errorData.error);
      }
      throw new Error(errorData.error.message);
    }

    // Handle empty responses
    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      return {} as T;
    }

    return response.json();
  }

  /**
   * Build query string from parameters, supporting nested filter serialization.
   */
  private buildQueryString(params?: Record<string, any>): string {
    if (!params) return '';

    const searchParams = new URLSearchParams();

    const formatDate = (date: Date | string): string => {
      if (date instanceof Date) {
        return date.toISOString().split('T')[0];
      }
      return new Date(date).toISOString().split('T')[0];
    };

    const append = (key: string, value: any): void => {
      if (value === undefined || value === null) {
        return;
      }

      if (Array.isArray(value)) {
        if (value.length === 0) {
          return;
        }
        searchParams.append(key, value.join(','));
        return;
      }

      if (value instanceof Date) {
        searchParams.append(key, formatDate(value));
        return;
      }

      if (typeof value === 'object') {
        if (key === 'filters') {
          this.serializeSearchFilters(value as SearchFilters, append);
          return;
        }

        Object.entries(value).forEach(([nestedKey, nestedValue]) => {
          append(`${key}[${nestedKey}]`, nestedValue);
        });
        return;
      }

      searchParams.append(key, String(value));
    };

    Object.entries(params).forEach(([key, value]) => append(key, value));

    const queryString = searchParams.toString();
    return queryString ? `?${queryString}` : '';
  }

  /**
   * Convert SearchFilters object into individual query parameters.
   */
  private serializeSearchFilters(filters: SearchFilters, append: (key: string, value: any) => void): void {
    const { badges, contentTypes, visibility, tags, dateRange } = filters;

    if (badges && badges.length > 0) {
      append('badges', badges.map(b => this.normalizeEnumValue(b)));
    }

    if (contentTypes && contentTypes.length > 0) {
      append('type', contentTypes.map(c => this.normalizeEnumValue(c)));
    }

    if (visibility && visibility.length > 0) {
      append('visibility', visibility.map(v => this.normalizeEnumValue(v)));
    }

    if (tags && tags.length > 0) {
      append('tags', tags);
    }

    if (dateRange) {
      if (dateRange.start) {
        append('startDate', dateRange.start);
      }
      if (dateRange.end) {
        append('endDate', dateRange.end);
      }
    }
  }

  /**
   * Normalize enum values to lowercase strings expected by the API.
   */
  private normalizeEnumValue(value: BadgeType | ContentType | Visibility | string): string {
    return String(value).toLowerCase();
  }

  // ============================================
  // Search API
  // ============================================

  /**
   * Search for community content
   */
  async search(
    params: ApiQueryParams<'/search', 'get'> & { filters?: SearchFilters }
  ): Promise<ApiResponse<'/search', 'get'>> {
    const queryString = this.buildQueryString(params);
    return this.request<ApiResponse<'/search', 'get'>>(`/search${queryString}`);
  }

  // ============================================
  // Channel API
  // ============================================

  async listChannels(): Promise<ChannelListResponse> {
    return this.request<ChannelListResponse>('/channels');
  }

  async createChannel(data: CreateChannelRequest): Promise<Channel> {
    return this.request<Channel>('/channels', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateChannel(channelId: string, data: UpdateChannelRequest): Promise<Channel> {
    return this.request<Channel>(`/channels/${channelId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteChannel(channelId: string): Promise<void> {
    await this.request<void>(`/channels/${channelId}`, {
      method: 'DELETE',
    });
  }

  async triggerChannelSync(channelId: string): Promise<TriggerSyncResponse> {
    return this.request<TriggerSyncResponse>(`/channels/${channelId}/sync`, {
      method: 'POST',
    });
  }

  // ============================================
  // Stats API
  // ============================================

  /**
   * Get platform statistics
   */
  async getStats(): Promise<ApiResponse<'/stats', 'get'>> {
    return this.request<ApiResponse<'/stats', 'get'>>('/stats');
  }

  // ============================================
  // Authentication API
  // ============================================

  /**
   * Register a new user
   */
  async register(
    data: { email: string; password: string; username: string }
  ): Promise<{ userId: string; message: string }> {
    return this.request<{ userId: string; message: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Login user
   */
  async login(
    data: { email: string; password: string }
  ): Promise<{
    accessToken: string;
    idToken: string;
    refreshToken: string;
    expiresIn: number;
    user: {
      id: string;
      email: string;
      username: string;
      profileSlug: string;
      isAdmin: boolean;
      isAwsEmployee: boolean;
    };
  }> {
    return this.request<{
      accessToken: string;
      idToken: string;
      refreshToken: string;
      expiresIn: number;
      user: {
        id: string;
        email: string;
        username: string;
        profileSlug: string;
        isAdmin: boolean;
        isAwsEmployee: boolean;
      };
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Verify email address
   */
  async verifyEmail(
    data: { email: string; confirmationCode: string }
  ): Promise<{ message: string; verified: boolean }> {
    return this.request<{ message: string; verified: boolean }>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async resendVerification(
    data: { email: string }
  ): Promise<{ message: string }> {
    return this.request<{ message: string }>('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Refresh access token
   */
  async refreshToken(
    data: { refreshToken: string }
  ): Promise<{
    accessToken: string;
    idToken?: string;
    expiresIn: number;
  }> {
    return this.request<{
      accessToken: string;
      idToken?: string;
      expiresIn: number;
    }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Request password reset
   */
  async forgotPassword(
    data: { email: string }
  ): Promise<{ message: string }> {
    return this.request<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Reset password with confirmation code
   */
  async resetPassword(
    data: { email: string; confirmationCode: string; newPassword: string }
  ): Promise<{ message: string }> {
    return this.request<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ============================================
  // Content API
  // ============================================

  /**
   * Get unclaimed content
   */
  async getUnclaimedContent(
    params?: {
      query?: string;
      contentType?: string;
      tags?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ content: Content[]; total: number }> {
    const queryString = this.buildQueryString(params);
    return this.request<{ content: Content[]; total: number }>(`/content/unclaimed${queryString}`);
  }

  /**
   * Claim a single content item
   */
  async claimContent(
    contentId: string
  ): Promise<{ success: boolean; content: any }> {
    return this.request<{ success: boolean; content: any }>(`/content/${contentId}/claim`, {
      method: 'POST',
    });
  }

  /**
   * Bulk claim multiple content items
   */
  async bulkClaimContent(
    contentIds: string[]
  ): Promise<{
    success: boolean;
    claimed: number;
    failed: number;
    errors?: { contentId: string; error: string }[];
  }> {
    return this.request<{
      success: boolean;
      claimed: number;
      failed: number;
      errors?: { contentId: string; error: string }[];
    }>('/content/bulk-claim', {
      method: 'POST',
      body: JSON.stringify({ contentIds }),
    });
  }

  /**
   * List user's content with filters
   */
  async listContent(
    params?: {
      contentType?: string;
      visibility?: string;
      tags?: string[];
      limit?: number;
      offset?: number;
    }
  ): Promise<{ content: Content[]; total: number }> {
    const queryParams = params ? {
      ...params,
      tags: params.tags?.join(',')
    } : undefined;
    const queryString = this.buildQueryString(queryParams);
    return this.request<{ content: Content[]; total: number }>(`/content${queryString}`);
  }

  /**
   * Create new content
   */
  async createContent(
    data: {
      title: string;
      description?: string;
      contentType: string;
      visibility?: string;
      urls: string[];
      tags?: string[];
      publishDate?: string;
      isClaimed?: boolean;
      originalAuthor?: string;
    }
  ): Promise<any> {
    return this.request<any>('/content', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Update content
   */
  async updateContent(
    contentId: string,
    data: {
      title?: string;
      description?: string;
      contentType?: string;
      visibility?: string;
      urls?: string[];
      tags?: string[];
      publishDate?: string;
    }
  ): Promise<any> {
    return this.request<any>(`/content/${contentId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete content
   */
  async deleteContent(contentId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/content/${contentId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Bulk update visibility for multiple content items
   */
  async bulkUpdateVisibility(
    contentIds: string[],
    visibility: string
  ): Promise<{ updated: number }> {
    return this.request<{ updated: number }>('/content/bulk-update-visibility', {
      method: 'POST',
      body: JSON.stringify({ contentIds, visibility }),
    });
  }

  /**
   * Get content by ID
   */
  async getContent(contentId: string): Promise<any> {
    return this.request<any>(`/content/${contentId}`);
  }

  /**
   * Find duplicate content items
   */
  async findDuplicates(
    params?: {
      threshold?: number;
      fields?: string[];
      contentId?: string;
    }
  ): Promise<{
    duplicates: Content[];
    similarity: number[];
  }> {
    const queryString = this.buildQueryString(params);
    return this.request<{
      duplicates: Content[];
      similarity: number[];
    }>(`/content/duplicates${queryString}`);
  }

  /**
   * Merge multiple content items into one
   */
  async mergeContent(
    data: {
      contentIds: string[];
      primaryId: string;
      reason?: string;
    }
  ): Promise<{
    success: boolean;
    mergedContentId: string;
    mergeId: string;
  }> {
    return this.request<{
      success: boolean;
      mergedContentId: string;
      mergeId: string;
    }>('/content/merge', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Undo a content merge (within 30 days)
   */
  async unmergeContent(
    mergeId: string
  ): Promise<{
    success: boolean;
    restoredContentIds: string[];
  }> {
    return this.request<{
      success: boolean;
      restoredContentIds: string[];
    }>(`/content/merge/${mergeId}/undo`, {
      method: 'POST',
    });
  }

  /**
   * Get merge history for user's content
   */
  async getMergeHistory(
    params?: {
      limit?: number;
      offset?: number;
      dateRange?: { start: Date; end: Date };
    }
  ): Promise<{
    merges: Array<{
      id: string;
      primaryContentId: string;
      mergedContentIds: string[];
      mergedAt: Date;
      mergedBy: string;
      canUndo: boolean;
      undoExpiresAt: Date;
    }>;
    total?: number;
    hasMore?: boolean;
  }> {
    const queryString = this.buildQueryString(params);
    return this.request<{
      merges: Array<{
        id: string;
        primaryContentId: string;
        mergedContentIds: string[];
        mergedAt: Date;
        mergedBy: string;
        canUndo: boolean;
        undoExpiresAt: Date;
      }>;
      total?: number;
      hasMore?: boolean;
    }>(`/content/merge-history${queryString}`);
  }

  // ============================================
  // User Profile API
  // ============================================

  // ============================================
  // User API
  // ============================================

  async getCurrentUser(): Promise<User> {
    return this.request<User>('/users/me');
  }

  async getUserBadges(): Promise<Badge[]> {
    return this.request<Badge[]>('/users/me/badges');
  }

  async updateUserProfile(userId: string, data: UpdateUserRequest): Promise<User> {
    return this.request<User>(`/api/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async getUserByUsername(username: string): Promise<User> {
    const response = await this.request<{ user: User }>(`/users/username/${username}`);
    return response.user;
  }

  async getUserBadgesByUserId(userId: string): Promise<Badge[]> {
    const response = await this.request<{ badges: Badge[] }>(`/users/${userId}/badges`);
    return response.badges;
  }

  async getUserContent(
    userId: string,
    params?: {
      visibility?: Visibility;
      limit?: number;
      offset?: number;
      tags?: string[];
      contentType?: ContentType;
    }
  ): Promise<{ content: Content[]; total: number }> {
    const queryParams: Record<string, any> | undefined = params
      ? {
          ...params,
          tags: params.tags ? params.tags.join(',') : undefined,
        }
      : undefined;

    const queryString = this.buildQueryString(queryParams);
    return this.request<{ content: Content[]; total: number }>(`/users/${userId}/content${queryString}`);
  }

  async changePassword(userId: string, data: ChangePasswordRequest): Promise<ChangePasswordResponse> {
    return this.request<ChangePasswordResponse>(`/api/users/${userId}/password`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async setupMfa(userId: string): Promise<MfaSetupResponse> {
    return this.request<MfaSetupResponse>(`/api/users/${userId}/mfa/setup`, {
      method: 'POST',
    });
  }

  async updatePreferences(userId: string, data: UpdatePreferencesRequest): Promise<UpdatePreferencesResponse> {
    return this.request<UpdatePreferencesResponse>(`/api/users/${userId}/preferences`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async exportUserData(userId: string): Promise<UserDataExport> {
    return this.request<UserDataExport>(`/api/users/${userId}/export`, {
      method: 'GET',
    });
  }

  async deleteAccount(userId: string): Promise<DeleteAccountResponse> {
    return this.request<DeleteAccountResponse>(`/api/users/${userId}`, {
      method: 'DELETE',
    });
  }
}

function defaultTokenProvider(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const persistent = window.localStorage?.getItem('accessToken');
    if (persistent && persistent.trim() !== '') {
      return persistent;
    }

    const session = window.sessionStorage?.getItem('accessToken');
    if (session && session.trim() !== '') {
      return session;
    }
  } catch {
    // Ignore storage access errors (e.g., in private mode)
  }

  return null;
}

function defaultErrorHandler(error: ApiError): void {
  if (process.env.NODE_ENV !== 'production') {
    console.error('API client error', error);
  }
}

/**
 * Create API client instance with optional overrides.
 */
export function createApiClient(config: ApiClientConfig = {}): ApiClient {
  return new ApiClient(config);
}

let sharedClient: ApiClient | null = null;
let sharedPublicClient: ApiClient | null = null;

/**
 * Retrieve shared authenticated API client instance.
 * Accepts optional overrides for testing while keeping singleton for app usage.
 */
export function getAuthenticatedApiClient(config?: ApiClientConfig): ApiClient {
  if (config && Object.keys(config).length > 0) {
    return new ApiClient(config);
  }

  if (!sharedClient) {
    sharedClient = new ApiClient({
      getAuthToken: defaultTokenProvider,
      onError: defaultErrorHandler,
    });
  }

  return sharedClient;
}

/**
 * Default shared API client instance reused across the application.
 */
export const apiClient = getAuthenticatedApiClient();

/**
 * Retrieve shared unauthenticated API client (no bearer token).
 */
export function getPublicApiClient(config?: ApiClientConfig): ApiClient {
  if (config && Object.keys(config).length > 0) {
    return new ApiClient({
      onError: defaultErrorHandler,
      ...config,
      getAuthToken: config.getAuthToken ?? (() => null),
    });
  }

  if (!sharedPublicClient) {
    sharedPublicClient = new ApiClient({
      getAuthToken: () => null,
      onError: defaultErrorHandler,
    });
  }

  return sharedPublicClient;
}
