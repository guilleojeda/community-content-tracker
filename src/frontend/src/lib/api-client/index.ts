import createClient from 'openapi-fetch';
import type { paths } from './schema';

// Create typed API client
export const apiClient = createClient<paths>({
  baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Export types for use in components
export type { paths, components } from './schema';
