import { getClientEnvironment } from '../config/environment';

export function getApiBaseUrl(): string {
  return getClientEnvironment().NEXT_PUBLIC_API_URL;
}

export function buildApiUrl(path: string): string {
  const base = getApiBaseUrl();
  if (!path.startsWith('/')) {
    return `${base}/${path}`;
  }
  return `${base}${path}`;
}
