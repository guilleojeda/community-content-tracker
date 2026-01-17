import { Pool, PoolConfig } from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

// Cached database connection pool
let cachedPool: Pool | null = null;

// Cached connection string to avoid repeated Secrets Manager calls
let cachedConnectionString: string | null = null;
// Test mode pool for injection
let testModePool: Pool | null = null;
const TEST_MODE_WARNING = 'Running in test mode without DATABASE_URL or injected pool';

const readEnv = (name: string, fallbackName?: string): string | null => {
  const value = process.env[name] ?? (fallbackName ? process.env[fallbackName] : undefined);
  if (!value || value.trim().length === 0) {
    return null;
  }
  return value.trim();
};

const requireEnv = (name: string, fallbackName?: string): string => {
  const value = readEnv(name, fallbackName);
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
};

const parseEnvNumber = (name: string, fallbackName?: string): number => {
  const value = requireEnv(name, fallbackName);
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be a valid number`);
  }
  return parsed;
};

const parseEnvBoolean = (name: string): boolean | null => {
  const value = readEnv(name);
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no'].includes(normalized)) {
    return false;
  }
  throw new Error(`${name} must be a boolean value`);
};

const resolveSslConfig = (usesSecrets: boolean): PoolConfig['ssl'] | undefined => {
  const explicitSsl =
    parseEnvBoolean('DB_SSL') ??
    parseEnvBoolean('DATABASE_SSL');
  if (explicitSsl === null) {
    return usesSecrets ? { rejectUnauthorized: false } : undefined;
  }
  return explicitSsl ? { rejectUnauthorized: false } : undefined;
};

function buildConnectionStringFromParts(): string | null {
  const host = readEnv('DB_HOST');
  const database = readEnv('DB_NAME');
  const user = readEnv('DB_USER');
  const password = readEnv('DB_PASSWORD');
  const port = readEnv('DB_PORT');

  if (!host || !database || !user || password === null || port === null) {
    return null;
  }

  const credentials = password !== ''
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(user);

  return `postgresql://${credentials}@${host}:${port}/${database}`;
}

function buildConnectionStringFromSecret(secret: Record<string, any>): string {
  const host = secret.host ?? readEnv('DB_HOST');
  const database = secret.dbname ?? secret.database ?? readEnv('DB_NAME');
  const user = secret.username ?? readEnv('DB_USER');
  const password = secret.password ?? readEnv('DB_PASSWORD');
  const portRaw = secret.port ?? readEnv('DB_PORT');
  const port = typeof portRaw === 'number' ? String(portRaw) : portRaw;

  if (!host || !database || !user || password === null || password === undefined || !port) {
    throw new Error('Missing database connection values in secret or environment');
  }

  const credentials = password !== ''
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(user);

  return `postgresql://${credentials}@${host}:${port}/${database}`;
}

function createNoopTestPool(): Pool {
  const noop = async () => undefined;
  const query = async () => ({ rows: [], rowCount: 0 } as const);
  const listeners: Array<(err: any) => void> = [];

  return {
    query,
    connect: async () => ({
      query,
      release: () => undefined,
    }),
    end: noop,
    on: (event: string, handler: (err: any) => void) => {
      if (event === 'error') {
        listeners.push(handler);
      }
      return undefined as any;
    },
    once: () => undefined as any,
    off: () => undefined as any,
    removeListener: () => undefined as any,
    emit: (event: string, error: any) => {
      if (event === 'error') {
        listeners.forEach(listener => listener(error));
        return true;
      }
      return false;
    },
  } as unknown as Pool;
}

/**
 * Retrieves database connection string from AWS Secrets Manager
 * Caches the result to avoid repeated API calls
 *
 * @param secretArn - ARN of the secret containing the connection string
 * @returns Database connection string
 */
async function getConnectionString(secretArn: string): Promise<string> {
  if (cachedConnectionString) {
    return cachedConnectionString;
  }

  const client = new SecretsManagerClient({ region: requireEnv('AWS_REGION') });

  try {
    const response = await client.send(new GetSecretValueCommand({
      SecretId: secretArn,
    }));

    if (!response.SecretString) {
      throw new Error('Secret value is empty');
    }

    const secret = JSON.parse(response.SecretString);
    cachedConnectionString = secret.connection_string;

    if (!cachedConnectionString) {
      cachedConnectionString = buildConnectionStringFromSecret(secret);
    }

    return cachedConnectionString;
  } catch (error: any) {
    console.error('Failed to retrieve database secret:', error);
    throw new Error(`Failed to retrieve database secret: ${error.message}`);
  }
}

/**
 * Sets a test pool for dependency injection in tests
 * This allows tests to inject mocked pools without needing environment variables
 *
 * @param pool - Mock pool instance or null to clear
 */
export function setTestDatabasePool(pool: Pool | null): void {
  testModePool = pool;
  // Clear cached pool when switching to test mode
  if (pool) {
    cachedPool = null;
  }
}

/**
 * Creates and returns a database connection pool
 * Uses lazy initialization with caching for optimal Lambda performance
 *
 * For local development, falls back to DATABASE_URL environment variable
 * In test mode, returns injected test pool if available
 *
 * @param config - Optional pool configuration overrides
 * @returns Promise resolving to a configured pg Pool instance
 */
export async function getDatabasePool(config?: Partial<PoolConfig>): Promise<Pool> {
  // Allow test injection - highest priority
  if (testModePool) {
    return testModePool;
  }

  // Return cached pool if available
  if (cachedPool) {
    return cachedPool;
  }

  let connectionString: string;
  const secretArn = process.env.DATABASE_SECRET_ARN;
  const usesSecrets = Boolean(secretArn);

  // Check if DATABASE_SECRET_ARN is provided (production/AWS)
  if (secretArn) {
    connectionString = await getConnectionString(secretArn);
  }
  // Fall back to DATABASE_URL for local development
  else {
    const envConnectionString = process.env.DATABASE_URL || buildConnectionStringFromParts();

    if (envConnectionString) {
      connectionString = envConnectionString;
    } else if (process.env.NODE_ENV === 'test') {
      console.warn(TEST_MODE_WARNING);
      const mockPool = createNoopTestPool();
      testModePool = mockPool;
      return mockPool;
    } else {
      throw new Error('Neither DATABASE_SECRET_ARN nor DATABASE_URL environment variable is set');
    }
  }

  const poolConfig: PoolConfig = {
    connectionString,
    max: parseEnvNumber('DATABASE_POOL_MAX', 'DB_POOL_MAX'),
    min: parseEnvNumber('DATABASE_POOL_MIN', 'DB_POOL_MIN'),
    idleTimeoutMillis: parseEnvNumber('DATABASE_POOL_IDLE_TIMEOUT_MS', 'DB_POOL_IDLE_TIMEOUT'),
    connectionTimeoutMillis: parseEnvNumber('DATABASE_POOL_CONNECTION_TIMEOUT_MS', 'DB_POOL_ACQUIRE_TIMEOUT'),
    ssl: resolveSslConfig(usesSecrets),
    ...config,
  };

  cachedPool = new Pool(poolConfig);
  cachedPool.on('error', (err: any) => {
    if (err?.code === '57P01') {
      console.warn('Postgres pool connection terminated (57P01).');
      return;
    }
    console.error('Unexpected database pool error', err);
  });

  return cachedPool;
}

/**
 * Closes the database connection pool
 * Should be called during Lambda shutdown or in tests
 */
export async function closeDatabasePool(): Promise<void> {
  if (cachedPool) {
    await cachedPool.end();
    cachedPool = null;
    cachedConnectionString = null;
  }
  if (testModePool) {
    testModePool = null;
  }
}

/**
 * Resets the cached pool and connection string
 * Useful for testing to force re-initialization
 */
export function resetDatabaseCache(): void {
  cachedPool = null;
  cachedConnectionString = null;
  testModePool = null;
}
