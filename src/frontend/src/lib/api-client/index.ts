import createClient from 'openapi-fetch';
import type { paths } from './schema';
import { getApiBaseUrl } from '../env';

// Create typed API client
export const apiClient = createClient<paths>({
  baseUrl: getApiBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
});

// Export types for use in components
export type { paths, components } from './schema';
