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
    parsed.push('http://localhost:3000');
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
  const headers = options.allowHeaders ?? process.env.CORS_ALLOW_HEADERS ?? 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token';
  const methods = options.methods ?? 'GET,POST,PUT,DELETE,OPTIONS';
  const maxAgeSeconds = options.maxAgeSeconds ?? Number(process.env.CORS_MAX_AGE ?? '86400');
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
