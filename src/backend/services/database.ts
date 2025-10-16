import { Pool, PoolConfig } from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

// Cached database connection pool
let cachedPool: Pool | null = null;

// Cached connection string to avoid repeated Secrets Manager calls
let cachedConnectionString: string | null = null;
// Test mode pool for injection
let testModePool: Pool | null = null;
const TEST_MODE_WARNING = 'Running in test mode without DATABASE_URL or injected pool';

function buildConnectionStringFromParts(): string | null {
  const host = process.env.DB_HOST;
  const database = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;

  if (!host || !database || !user || password === undefined) {
    return null;
  }

  const port = process.env.DB_PORT || '5432';
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

  const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

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
      throw new Error('connection_string not found in secret');
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

  // Check if DATABASE_SECRET_ARN is provided (production/AWS)
  if (process.env.DATABASE_SECRET_ARN) {
    connectionString = await getConnectionString(process.env.DATABASE_SECRET_ARN);
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

  // Create pool with standardized configuration
  const poolConfig: PoolConfig = {
    connectionString,
    max: 5,  // Standardized max connections
    min: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ...config, // Allow overrides for testing
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
