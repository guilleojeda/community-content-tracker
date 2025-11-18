const { z } = require('zod');

const EnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url({ message: 'NEXT_PUBLIC_API_URL must be a valid URL' }),
  NEXT_PUBLIC_COGNITO_USER_POOL_ID: z.string().optional(),
  NEXT_PUBLIC_COGNITO_CLIENT_ID: z.string().optional(),
  NEXT_PUBLIC_AWS_REGION: z.string().min(1).default('us-east-1'),
  NEXT_PUBLIC_ENVIRONMENT: z.string().min(1).default('development'),
  NEXT_PUBLIC_FEEDBACK_URL: z.string().url().optional(),
  NEXT_PUBLIC_ENABLE_BETA_FEATURES: z.enum(['true', 'false']).optional(),
});

function loadEnv() {
  const source = {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_COGNITO_USER_POOL_ID: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
    NEXT_PUBLIC_COGNITO_CLIENT_ID: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
    NEXT_PUBLIC_AWS_REGION: process.env.NEXT_PUBLIC_AWS_REGION,
    NEXT_PUBLIC_ENVIRONMENT: process.env.NEXT_PUBLIC_ENVIRONMENT,
    NEXT_PUBLIC_FEEDBACK_URL: process.env.NEXT_PUBLIC_FEEDBACK_URL,
    NEXT_PUBLIC_ENABLE_BETA_FEATURES: process.env.NEXT_PUBLIC_ENABLE_BETA_FEATURES,
  };

  const isProductionBuild = process.env.NODE_ENV === 'production';
  const normalizedEnvironment = source.NEXT_PUBLIC_ENVIRONMENT && source.NEXT_PUBLIC_ENVIRONMENT.trim().length > 0
    ? source.NEXT_PUBLIC_ENVIRONMENT.trim()
    : 'development';
  source.NEXT_PUBLIC_ENVIRONMENT = normalizedEnvironment;

  const isLocalDevelopmentEnv = normalizedEnvironment.toLowerCase() === 'development';
  const trimmedApiUrl = source.NEXT_PUBLIC_API_URL ? source.NEXT_PUBLIC_API_URL.trim() : '';

  // Provide default for build-time when not explicitly set
  // Build-time uses default, runtime should have actual deployment URL
  // This allows: npm run build, CI builds, development, and testing
  if (!trimmedApiUrl) {
    if (isProductionBuild && !isLocalDevelopmentEnv) {
      throw new Error('NEXT_PUBLIC_API_URL must be set for production builds');
    }

    source.NEXT_PUBLIC_API_URL = 'http://localhost:3001/api';
    if (!isLocalDevelopmentEnv) {
      console.warn('[WARNING] NEXT_PUBLIC_API_URL not set, using default: http://localhost:3001/api');
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[WARNING] For production deployments, set NEXT_PUBLIC_API_URL to your actual API endpoint');
      }
    }
  } else {
    source.NEXT_PUBLIC_API_URL = trimmedApiUrl;
  }

  if (!source.NEXT_PUBLIC_ENABLE_BETA_FEATURES) {
    source.NEXT_PUBLIC_ENABLE_BETA_FEATURES = source.NEXT_PUBLIC_ENVIRONMENT === 'beta' ? 'true' : 'false';
  }

  if (!source.NEXT_PUBLIC_FEEDBACK_URL || source.NEXT_PUBLIC_FEEDBACK_URL.trim() === '') {
    source.NEXT_PUBLIC_FEEDBACK_URL = 'https://awscommunityhub.org/beta-feedback';
  }

  const result = EnvSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => issue.message).join('; ');
    throw new Error(`Invalid Next.js environment configuration: ${issues}`);
  }

  return result.data;
}

module.exports = {
  loadEnv,
};
