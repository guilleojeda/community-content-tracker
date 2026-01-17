import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT || 4173);
const BACKEND_PORT = Number(process.env.PLAYWRIGHT_BACKEND_PORT || 3001);
const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || `http://127.0.0.1:${BACKEND_PORT}`;
const siteUrl = `http://127.0.0.1:${PORT}`;
const backendUrl = `http://127.0.0.1:${BACKEND_PORT}`;
const reuseServer = process.env.PLAYWRIGHT_REUSE_SERVER === 'true';
const fallbackCorsOrigins = `${siteUrl},http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e/ui',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: [
    {
      name: 'backend',
      command: 'npm run dev --workspace=src/backend',
      url: `${backendUrl}/health`,
      reuseExistingServer: reuseServer,
      timeout: 180_000,
      env: {
        ...process.env,
        TS_NODE_COMPILER_OPTIONS: process.env.TS_NODE_COMPILER_OPTIONS || '{"module":"CommonJS"}',
        PORT: String(BACKEND_PORT),
        LOCAL_API_PROJECTS: process.env.LOCAL_API_PROJECTS || 'chromium,firefox,webkit',
        LOCAL_AUTH_MODE: 'true',
        DISABLE_SCRAPER_INVOCATION: 'true',
        DISABLE_CLOUDWATCH_METRICS: 'true',
        DISABLE_SEMANTIC_SEARCH: 'true',
        SKIP_URL_ACCESSIBILITY_CHECK: 'true',
        TEST_DB_INMEMORY: 'true',
        DATABASE_URL: '',
        LOCAL_PG_URL: '',
        REDIS_URL: '',
        AWS_REGION: process.env.AWS_REGION || 'us-east-1',
        BEDROCK_REGION: process.env.BEDROCK_REGION || 'us-east-1',
        BEDROCK_MODEL_ID: process.env.BEDROCK_MODEL_ID || 'amazon.titan-embed-text-v1',
        COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID || 'local-user-pool',
        COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID || 'local-client-id',
        COGNITO_REGION: process.env.COGNITO_REGION || 'us-east-1',
        TOKEN_VERIFICATION_TIMEOUT_MS: process.env.TOKEN_VERIFICATION_TIMEOUT_MS || '3000',
        MFA_TOTP_SEED: process.env.MFA_TOTP_SEED || 'LOCALMFASEED123456',
        ALLOWED_AUDIENCES: process.env.ALLOWED_AUDIENCES || '',
        JWT_SECRET: process.env.JWT_SECRET || 'local-jwt-secret',
        BLOG_SCRAPER_FUNCTION_NAME: process.env.BLOG_SCRAPER_FUNCTION_NAME || 'local-blog-scraper',
        YOUTUBE_SCRAPER_FUNCTION_NAME: process.env.YOUTUBE_SCRAPER_FUNCTION_NAME || 'local-youtube-scraper',
        GITHUB_SCRAPER_FUNCTION_NAME: process.env.GITHUB_SCRAPER_FUNCTION_NAME || 'local-github-scraper',
        CORS_ORIGIN: process.env.CORS_ORIGIN || fallbackCorsOrigins,
        CORS_ALLOW_HEADERS: process.env.CORS_ALLOW_HEADERS || 'Authorization,Content-Type',
        CORS_ALLOW_METHODS: process.env.CORS_ALLOW_METHODS || 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        CORS_MAX_AGE: process.env.CORS_MAX_AGE || '600',
        CORS_CREDENTIALS: process.env.CORS_CREDENTIALS || 'true',
        RATE_LIMIT_ANONYMOUS: process.env.RATE_LIMIT_ANONYMOUS || '1000',
        RATE_LIMIT_AUTHENTICATED: process.env.RATE_LIMIT_AUTHENTICATED || '1000',
        RATE_LIMIT_WINDOW_MINUTES: process.env.RATE_LIMIT_WINDOW_MINUTES || '1',
        STATS_CACHE_TTL: process.env.STATS_CACHE_TTL || '60',
      },
    },
    {
      name: 'frontend',
      command: `npm run build --workspace=src/frontend && npm run start --workspace=src/frontend -- --port ${PORT}`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: reuseServer,
      timeout: 180_000,
      env: {
        ...process.env,
        LOCAL_API_MODE: 'false',
        LOCAL_API_PREFIX: '/api',
        LOCAL_API_PROJECTS: process.env.LOCAL_API_PROJECTS || 'chromium,firefox,webkit',
        NEXT_PUBLIC_STATIC_EXPORT: 'false',
        NEXT_PUBLIC_API_URL: apiBaseUrl,
        NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || siteUrl,
        NEXT_PUBLIC_AWS_REGION: process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1',
        NEXT_PUBLIC_ENVIRONMENT: process.env.NEXT_PUBLIC_ENVIRONMENT || 'development',
        NEXT_PUBLIC_FEEDBACK_URL: process.env.NEXT_PUBLIC_FEEDBACK_URL || 'https://awscommunityhub.org/beta-feedback',
        NEXT_PUBLIC_ENABLE_BETA_FEATURES: process.env.NEXT_PUBLIC_ENABLE_BETA_FEATURES || 'false',
        NEXT_PUBLIC_USE_PREACT: process.env.NEXT_PUBLIC_USE_PREACT || 'false',
      },
    },
  ],
});
