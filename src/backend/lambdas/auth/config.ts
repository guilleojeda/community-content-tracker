import { z } from 'zod';

export interface AuthEnvironment {
  userPoolId: string;
  clientId: string;
  region: string;
  awsRegion: string;
  allowedAudiences: string[];
  tokenVerificationTimeoutMs: number;
  mfaTotpSeed: string;
}

const AuthEnvSchema = z.object({
  COGNITO_USER_POOL_ID: z.string().min(1, 'COGNITO_USER_POOL_ID is required'),
  COGNITO_CLIENT_ID: z.string().min(1, 'COGNITO_CLIENT_ID is required'),
  COGNITO_REGION: z.string().min(1, 'COGNITO_REGION is required'),
  AWS_REGION: z.string().min(1, 'AWS_REGION is required'),
  ALLOWED_AUDIENCES: z.string().optional(),
  TOKEN_VERIFICATION_TIMEOUT_MS: z.preprocess(
    (value) => (value === undefined ? undefined : Number(value)),
    z.number().positive({ message: 'TOKEN_VERIFICATION_TIMEOUT_MS is required' })
  ),
  MFA_TOTP_SEED: z.string().min(1, 'MFA_TOTP_SEED is required'),
});

let cachedEnv: AuthEnvironment | null = null;

function buildAuthEnvironment(): AuthEnvironment {
  const source: Record<string, unknown> = {
    ...process.env,
  };

  if (process.env.NODE_ENV === 'test') {
    source.COGNITO_USER_POOL_ID = source.COGNITO_USER_POOL_ID || 'test-user-pool-id';
    source.COGNITO_CLIENT_ID = source.COGNITO_CLIENT_ID || 'test-client-id';
    source.COGNITO_REGION = source.COGNITO_REGION || 'us-east-1';
    source.AWS_REGION = source.AWS_REGION || 'us-east-1';
    source.MFA_TOTP_SEED = source.MFA_TOTP_SEED || 'TESTMFASEED123456';
    source.ALLOWED_AUDIENCES = source.ALLOWED_AUDIENCES || '';
    source.TOKEN_VERIFICATION_TIMEOUT_MS = source.TOKEN_VERIFICATION_TIMEOUT_MS || '3000';
  }

  const result = AuthEnvSchema.safeParse(source);
  if (!result.success) {
    const message = result.error.errors.map((err) => err.message).join('; ');
    throw new Error(`Invalid authentication environment configuration: ${message}`);
  }

  const { COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, COGNITO_REGION, AWS_REGION, ALLOWED_AUDIENCES, TOKEN_VERIFICATION_TIMEOUT_MS, MFA_TOTP_SEED } =
    result.data;

  const allowedAudiences = ALLOWED_AUDIENCES
    ? ALLOWED_AUDIENCES.split(',').map((audience) => audience.trim()).filter(Boolean)
    : [];

  return {
    userPoolId: COGNITO_USER_POOL_ID,
    clientId: COGNITO_CLIENT_ID,
    region: COGNITO_REGION,
    awsRegion: AWS_REGION,
    allowedAudiences,
    tokenVerificationTimeoutMs: TOKEN_VERIFICATION_TIMEOUT_MS,
    mfaTotpSeed: MFA_TOTP_SEED,
  };
}

export function getAuthEnvironment(): AuthEnvironment {
  if (process.env.NODE_ENV === 'test') {
    // Always rebuild configuration in tests to honour per-test overrides
    return buildAuthEnvironment();
  }

  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = buildAuthEnvironment();
  return cachedEnv;
}

export function resetAuthEnvironmentCache(): void {
  cachedEnv = null;
}
