import { z } from 'zod';

const ClientEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url({ message: 'NEXT_PUBLIC_API_URL must be a valid URL' }),
  NEXT_PUBLIC_COGNITO_USER_POOL_ID: z.string().optional(),
  NEXT_PUBLIC_COGNITO_CLIENT_ID: z.string().optional(),
  NEXT_PUBLIC_AWS_REGION: z.string().min(1).default('us-east-1'),
});

let cachedEnv: z.infer<typeof ClientEnvSchema> | null = null;

export function getClientEnvironment(): z.infer<typeof ClientEnvSchema> {
  if (typeof window === 'undefined') {
    if (process.env.NODE_ENV === 'test') {
      return parseEnvironment();
    }

    if (!cachedEnv) {
      cachedEnv = parseEnvironment();
    }

    return cachedEnv;
  }

  if (!cachedEnv) {
    cachedEnv = parseEnvironment();
  }

  return cachedEnv;
}

function parseEnvironment(): z.infer<typeof ClientEnvSchema> {
  const source = {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_COGNITO_USER_POOL_ID: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
    NEXT_PUBLIC_COGNITO_CLIENT_ID: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
    NEXT_PUBLIC_AWS_REGION: process.env.NEXT_PUBLIC_AWS_REGION,
  };

  if (process.env.NODE_ENV === 'test' && (!source.NEXT_PUBLIC_API_URL || source.NEXT_PUBLIC_API_URL.trim() === '')) {
    source.NEXT_PUBLIC_API_URL = 'http://localhost:3001';
  }

  const result = ClientEnvSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => issue.message).join('; ');
    throw new Error(`Invalid client environment configuration: ${issues}`);
  }

  return {
    ...result.data,
    NEXT_PUBLIC_API_URL: stripTrailingSlash(result.data.NEXT_PUBLIC_API_URL),
  } as z.infer<typeof ClientEnvSchema>;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function resetClientEnvironmentCache(): void {
  cachedEnv = null;
}
