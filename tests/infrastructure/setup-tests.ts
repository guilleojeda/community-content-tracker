import * as fs from 'fs';
import * as path from 'path';

process.env.DATABASE_POOL_MIN = process.env.DATABASE_POOL_MIN || '1';
process.env.DATABASE_POOL_MAX = process.env.DATABASE_POOL_MAX || '5';
process.env.DATABASE_POOL_IDLE_TIMEOUT_MS = process.env.DATABASE_POOL_IDLE_TIMEOUT_MS || '30000';
process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || '60000';
process.env.BEDROCK_REGION = process.env.BEDROCK_REGION || 'us-east-1';
process.env.BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'amazon.titan-embed-text-v1';
process.env.ENABLE_BETA_FEATURES = process.env.ENABLE_BETA_FEATURES || 'false';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
process.env.CORS_ALLOW_HEADERS = process.env.CORS_ALLOW_HEADERS || 'Authorization,Content-Type';
process.env.CORS_ALLOW_METHODS = process.env.CORS_ALLOW_METHODS || 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
process.env.CORS_MAX_AGE = process.env.CORS_MAX_AGE || '600';
process.env.RATE_LIMIT_ANONYMOUS = process.env.RATE_LIMIT_ANONYMOUS || '100';
process.env.RATE_LIMIT_AUTHENTICATED = process.env.RATE_LIMIT_AUTHENTICATED || '1000';
process.env.RATE_LIMIT_WINDOW_MINUTES = process.env.RATE_LIMIT_WINDOW_MINUTES || '1';
process.env.STATS_CACHE_TTL = process.env.STATS_CACHE_TTL || '60';
process.env.AUTH_RATE_LIMIT_PER_MINUTE = process.env.AUTH_RATE_LIMIT_PER_MINUTE || '1000';
process.env.TOKEN_VERIFICATION_TIMEOUT_MS = process.env.TOKEN_VERIFICATION_TIMEOUT_MS || '3000';
process.env.MFA_TOTP_SEED = process.env.MFA_TOTP_SEED || 'TESTMFASEED123456';
process.env.ANALYTICS_RETENTION_DAYS = process.env.ANALYTICS_RETENTION_DAYS || '730';
process.env.YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'test-youtube-key';
process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'test-github-token';
process.env.COGNITO_CALLBACK_URLS = process.env.COGNITO_CALLBACK_URLS || 'http://localhost:3000/callback';
process.env.COGNITO_LOGOUT_URLS = process.env.COGNITO_LOGOUT_URLS || 'http://localhost:3000/logout';
process.env.SYNTHETIC_URL = process.env.SYNTHETIC_URL || 'http://localhost:3000';
process.env.MONITORING_ERROR_RATE_THRESHOLD = process.env.MONITORING_ERROR_RATE_THRESHOLD || '0.01';
process.env.MONITORING_P99_LATENCY_MS = process.env.MONITORING_P99_LATENCY_MS || '1000';
process.env.MONITORING_DB_CONNECTION_THRESHOLD = process.env.MONITORING_DB_CONNECTION_THRESHOLD || '70';
process.env.MONITORING_DLQ_THRESHOLD = process.env.MONITORING_DLQ_THRESHOLD || '1';
process.env.MONITORING_DAILY_COST_THRESHOLD = process.env.MONITORING_DAILY_COST_THRESHOLD || '500';
process.env.MONITORING_SYNTHETIC_AVAILABILITY_THRESHOLD =
  process.env.MONITORING_SYNTHETIC_AVAILABILITY_THRESHOLD || '99';
process.env.MONITORING_BILLING_REGION = process.env.MONITORING_BILLING_REGION || 'us-east-1';
process.env.VPC_NAT_GATEWAYS = process.env.VPC_NAT_GATEWAYS || '1';
process.env.API_GW_THROTTLE_RATE_LIMIT = process.env.API_GW_THROTTLE_RATE_LIMIT || '100';
process.env.API_GW_THROTTLE_BURST_LIMIT = process.env.API_GW_THROTTLE_BURST_LIMIT || '200';
process.env.API_GW_DATA_TRACE_ENABLED = process.env.API_GW_DATA_TRACE_ENABLED || 'true';

const FRONTEND_OUT_DIR = path.resolve(process.cwd(), '../frontend/out');

function ensureFrontendBuildArtifacts(): void {
  if (fs.existsSync(FRONTEND_OUT_DIR)) {
    return;
  }

  fs.mkdirSync(FRONTEND_OUT_DIR, { recursive: true });
  const indexMarkup = '<!doctype html><html><head><meta charset="utf-8"><title>AWS Community Content Hub</title></head><body><h1>AWS Community Content Hub</h1></body></html>';
  const errorMarkup = '<!doctype html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Something went wrong</h1></body></html>';

  fs.writeFileSync(path.join(FRONTEND_OUT_DIR, 'index.html'), indexMarkup, { encoding: 'utf-8' });
  fs.writeFileSync(path.join(FRONTEND_OUT_DIR, 'error.html'), errorMarkup, { encoding: 'utf-8' });
}

ensureFrontendBuildArtifacts();
