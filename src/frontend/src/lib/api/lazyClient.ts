import type { ApiClientConfig } from '@/api/client';
import type { ApiClient } from '@/api';

let apiModulePromise: Promise<typeof import('@/api')> | null = null;
let apiClientModulePromise: Promise<typeof import('@/api/client')> | null = null;

async function getApiModule() {
  if (!apiModulePromise) {
    apiModulePromise = import('@/api');
  }
  return apiModulePromise;
}

async function getApiClientModule() {
  if (!apiClientModulePromise) {
    apiClientModulePromise = import('@/api/client');
  }
  return apiClientModulePromise;
}

/**
 * Lazily resolve the shared authenticated API client singleton.
 */
export async function loadSharedApiClient(): Promise<ApiClient> {
  const apiModule = await getApiModule();
  return apiModule.apiClient;
}

/**
 * Lazily resolve an authenticated API client. When no config is provided,
 * this returns the shared singleton used throughout the app.
 */
export async function loadAuthenticatedApiClient(
  config?: ApiClientConfig
): Promise<ApiClient> {
  const apiClientModule = await getApiClientModule();
  return apiClientModule.getAuthenticatedApiClient(config);
}

/**
 * Lazily resolve the unauthenticated/public API client.
 */
export async function loadPublicApiClient(config?: ApiClientConfig): Promise<ApiClient> {
  const apiClientModule = await getApiClientModule();
  return apiClientModule.getPublicApiClient(config);
}
