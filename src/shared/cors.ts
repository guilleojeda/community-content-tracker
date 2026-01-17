let cachedOrigins: string[] | null = null;

function parseAllowedOrigins(): string[] {
  if (cachedOrigins) {
    return cachedOrigins;
  }

  const originEnv = process.env.CORS_ORIGIN ?? '';
  const parsed = originEnv
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (parsed.length === 0) {
    throw new Error('CORS_ORIGIN must be set to at least one allowed origin');
  }

  cachedOrigins = parsed;
  return cachedOrigins;
}

export function resolveCorsOrigin(requestOrigin?: string | null): string {
  const allowedOrigins = parseAllowedOrigins();
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  return allowedOrigins[0];
}

export interface CorsOptions {
  origin?: string | null;
  methods?: string;
  allowCredentials?: boolean;
  allowHeaders?: string;
  maxAgeSeconds?: number;
}

export function buildCorsHeaders(options: CorsOptions = {}): Record<string, string> {
  const headers = options.allowHeaders ?? process.env.CORS_ALLOW_HEADERS;
  if (!headers || headers.trim().length === 0) {
    throw new Error('CORS_ALLOW_HEADERS must be set');
  }

  const methods = options.methods ?? process.env.CORS_ALLOW_METHODS;
  if (!methods || methods.trim().length === 0) {
    throw new Error('CORS_ALLOW_METHODS must be set');
  }

  const maxAgeValue = options.maxAgeSeconds ?? process.env.CORS_MAX_AGE;
  if (maxAgeValue === undefined || maxAgeValue === null || String(maxAgeValue).trim().length === 0) {
    throw new Error('CORS_MAX_AGE must be set');
  }
  const maxAgeSeconds = typeof maxAgeValue === 'number' ? maxAgeValue : Number(maxAgeValue);
  if (Number.isNaN(maxAgeSeconds)) {
    throw new Error('CORS_MAX_AGE must be a valid number');
  }
  const resolvedOrigin = resolveCorsOrigin(options.origin ?? undefined);

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': resolvedOrigin,
    'Access-Control-Allow-Headers': headers,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Max-Age': String(maxAgeSeconds),
    Vary: 'Origin',
  };

  if (options.allowCredentials ?? process.env.CORS_CREDENTIALS === 'true') {
    corsHeaders['Access-Control-Allow-Credentials'] = 'true';
  }

  return corsHeaders;
}

export function resetCorsCache(): void {
  cachedOrigins = null;
}
