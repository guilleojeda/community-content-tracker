const { z } = require('zod');

const EnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url({ message: 'NEXT_PUBLIC_API_URL must be a valid URL' }),
  NEXT_PUBLIC_SITE_URL: z.string().url({ message: 'NEXT_PUBLIC_SITE_URL must be a valid URL' }),
  NEXT_PUBLIC_COGNITO_USER_POOL_ID: z.string().optional(),
  NEXT_PUBLIC_COGNITO_CLIENT_ID: z.string().optional(),
  NEXT_PUBLIC_AWS_REGION: z.string().min(1, { message: 'NEXT_PUBLIC_AWS_REGION is required' }),
  NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: z.string().optional(),
  NEXT_PUBLIC_YANDEX_SITE_VERIFICATION: z.string().optional(),
  NEXT_PUBLIC_IMAGE_CDN_URL: z.string().url({ message: 'NEXT_PUBLIC_IMAGE_CDN_URL must be a valid URL' }).optional(),
  NEXT_PUBLIC_ENVIRONMENT: z.string().min(1, { message: 'NEXT_PUBLIC_ENVIRONMENT is required' }),
  NEXT_PUBLIC_FEEDBACK_URL: z.string().url({ message: 'NEXT_PUBLIC_FEEDBACK_URL must be a valid URL' }),
  NEXT_PUBLIC_ENABLE_BETA_FEATURES: z.enum(['true', 'false']),
});

function loadEnv() {
  const source = {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_COGNITO_USER_POOL_ID: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
    NEXT_PUBLIC_COGNITO_CLIENT_ID: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
    NEXT_PUBLIC_AWS_REGION: process.env.NEXT_PUBLIC_AWS_REGION,
    NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
    NEXT_PUBLIC_YANDEX_SITE_VERIFICATION: process.env.NEXT_PUBLIC_YANDEX_SITE_VERIFICATION,
    NEXT_PUBLIC_IMAGE_CDN_URL: process.env.NEXT_PUBLIC_IMAGE_CDN_URL,
    NEXT_PUBLIC_ENVIRONMENT: process.env.NEXT_PUBLIC_ENVIRONMENT,
    NEXT_PUBLIC_FEEDBACK_URL: process.env.NEXT_PUBLIC_FEEDBACK_URL,
    NEXT_PUBLIC_ENABLE_BETA_FEATURES: process.env.NEXT_PUBLIC_ENABLE_BETA_FEATURES,
  };

  if (source.NEXT_PUBLIC_ENVIRONMENT) {
    source.NEXT_PUBLIC_ENVIRONMENT = source.NEXT_PUBLIC_ENVIRONMENT.trim();
  }

  if (source.NEXT_PUBLIC_API_URL) {
    source.NEXT_PUBLIC_API_URL = source.NEXT_PUBLIC_API_URL.trim();
  }

  if (source.NEXT_PUBLIC_SITE_URL) {
    source.NEXT_PUBLIC_SITE_URL = source.NEXT_PUBLIC_SITE_URL.trim();
  }

  if (source.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION) {
    source.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION = source.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION.trim();
  }

  if (source.NEXT_PUBLIC_YANDEX_SITE_VERIFICATION) {
    source.NEXT_PUBLIC_YANDEX_SITE_VERIFICATION = source.NEXT_PUBLIC_YANDEX_SITE_VERIFICATION.trim();
  }

  if (source.NEXT_PUBLIC_IMAGE_CDN_URL !== undefined) {
    const trimmed = source.NEXT_PUBLIC_IMAGE_CDN_URL.trim();
    source.NEXT_PUBLIC_IMAGE_CDN_URL = trimmed.length > 0 ? trimmed : undefined;
  }

  if (source.NEXT_PUBLIC_FEEDBACK_URL) {
    source.NEXT_PUBLIC_FEEDBACK_URL = source.NEXT_PUBLIC_FEEDBACK_URL.trim();
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
