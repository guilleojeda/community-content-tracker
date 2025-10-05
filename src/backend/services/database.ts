import { Pool, PoolConfig } from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

// Cached database connection pool
let cachedPool: Pool | null = null;

// Cached connection string to avoid repeated Secrets Manager calls
let cachedConnectionString: string | null = null;

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
 * Creates and returns a database connection pool
 * Uses lazy initialization with caching for optimal Lambda performance
 *
 * For local development, falls back to DATABASE_URL environment variable
 *
 * @param config - Optional pool configuration overrides
 * @returns Promise resolving to a configured pg Pool instance
 */
export async function getDatabasePool(config?: Partial<PoolConfig>): Promise<Pool> {
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
  else if (process.env.DATABASE_URL) {
    connectionString = process.env.DATABASE_URL;
  }
  else {
    throw new Error('Neither DATABASE_SECRET_ARN nor DATABASE_URL environment variable is set');
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
}

/**
 * Resets the cached pool and connection string
 * Useful for testing to force re-initialization
 */
export function resetDatabaseCache(): void {
  cachedPool = null;
  cachedConnectionString = null;
}
