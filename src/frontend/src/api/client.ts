/**
 * Typed API client for AWS Community Content Hub
 * Generated from OpenAPI specification
 */

import type { paths } from './schema';

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
 * API Error type
 */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export interface ApiErrorResponse {
  error: ApiError;
}

/**
 * API client configuration
 */
export interface ApiClientConfig {
  baseUrl?: string;
  getAuthToken?: () => string | null | Promise<string | null>;
  onError?: (error: ApiError) => void;
}

/**
 * Typed API client
 */
export class ApiClient {
  private baseUrl: string;
  private getAuthToken?: () => string | null | Promise<string | null>;
  private onError?: (error: ApiError) => void;

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = config.baseUrl || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
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
   * Build query string from parameters
   */
  private buildQueryString(params?: Record<string, any>): string {
    if (!params) return '';

    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });

    const queryString = searchParams.toString();
    return queryString ? `?${queryString}` : '';
  }

  // ============================================
  // Search API
  // ============================================

  /**
   * Search for community content
   */
  async search(
    params: ApiQueryParams<'/search', 'get'>
  ): Promise<ApiResponse<'/search', 'get'>> {
    const queryString = this.buildQueryString(params);
    return this.request<ApiResponse<'/search', 'get'>>(`/search${queryString}`);
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
    data: ApiRequestBody<'/auth/register', 'post'>
  ): Promise<ApiResponse<'/auth/register', 'post'>> {
    return this.request<ApiResponse<'/auth/register', 'post'>>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Login user
   */
  async login(
    data: ApiRequestBody<'/auth/login', 'post'>
  ): Promise<ApiResponse<'/auth/login', 'post'>> {
    return this.request<ApiResponse<'/auth/login', 'post'>>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Verify email address
   */
  async verifyEmail(
    data: ApiRequestBody<'/auth/verify-email', 'post'>
  ): Promise<ApiResponse<'/auth/verify-email', 'post'>> {
    return this.request<ApiResponse<'/auth/verify-email', 'post'>>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Refresh access token
   */
  async refreshToken(
    data: ApiRequestBody<'/auth/refresh', 'post'>
  ): Promise<ApiResponse<'/auth/refresh', 'post'>> {
    return this.request<ApiResponse<'/auth/refresh', 'post'>>('/auth/refresh', {
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
}

/**
 * Create default API client instance
 */
export function createApiClient(config?: ApiClientConfig): ApiClient {
  return new ApiClient(config);
}

/**
 * Default API client instance
 */
export const apiClient = createApiClient();
