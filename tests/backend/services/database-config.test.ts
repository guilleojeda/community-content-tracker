import type { Pool } from 'pg';
import { consumeConsoleOutput } from '../../setup/consoleMock';
const sendMock = jest.fn();
const secretsClientMock = jest.fn();
const getSecretValueCommandMock = jest.fn().mockImplementation((input) => ({ input }));

jest.mock('@aws-sdk/client-secrets-manager', () => {
  class SecretsManagerClient {
    constructor(config: any) {
      secretsClientMock(config);
    }

    send(command: any) {
      return sendMock(command);
    }
  }

  return {
    SecretsManagerClient,
    GetSecretValueCommand: getSecretValueCommandMock,
  };
});

const originalEnv = process.env;
const databaseModule = require('../../../src/backend/src/database/config/database');

describe('database config', () => {
  beforeEach(() => {
    sendMock.mockReset();
    secretsClientMock.mockClear();
    getSecretValueCommandMock.mockClear();
    process.env = { ...originalEnv };
    databaseModule.resetDatabaseCache();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns injected pool when setTestDatabasePool is used', async () => {
    const { getDatabasePool, setTestDatabasePool, resetDatabaseCache } = databaseModule;
    const injectedPool = { query: jest.fn() } as unknown as Pool;

    setTestDatabasePool(injectedPool);
    const result = await getDatabasePool();

    expect(result).toBe(injectedPool);
    resetDatabaseCache();
  });

  it('builds pool using DATABASE_URL when provided', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/app';
    process.env.DATABASE_POOL_MAX = '5';
    process.env.DATABASE_POOL_MIN = '1';
    process.env.DATABASE_POOL_IDLE_TIMEOUT_MS = '30000';
    process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = '60000';

    const { getDatabasePool, closeDatabasePool } = databaseModule;
    const pool = await getDatabasePool();

    expect(pool.options).toMatchObject({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      min: 1,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 60000,
    });
    await closeDatabasePool();
  });

  it('uses fallback pool settings when DB_POOL_* env vars are set', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/app';
    delete process.env.DATABASE_POOL_MAX;
    delete process.env.DATABASE_POOL_MIN;
    delete process.env.DATABASE_POOL_IDLE_TIMEOUT_MS;
    delete process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS;
    process.env.DB_POOL_MAX = '6';
    process.env.DB_POOL_MIN = '2';
    process.env.DB_POOL_IDLE_TIMEOUT = '15000';
    process.env.DB_POOL_ACQUIRE_TIMEOUT = '25000';

    const { getDatabasePool, closeDatabasePool } = databaseModule;
    const pool = await getDatabasePool();

    expect(pool.options).toMatchObject({
      max: 6,
      min: 2,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 25000,
    });

    await closeDatabasePool();
  });

  it('throws when required pool settings are missing', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/app';
    delete process.env.DATABASE_POOL_MAX;
    delete process.env.DB_POOL_MAX;

    const { getDatabasePool } = databaseModule;

    await expect(getDatabasePool()).rejects.toThrow('DATABASE_POOL_MAX must be set');
  });

  it('throws when pool settings are not numeric', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/app';
    process.env.DATABASE_POOL_MAX = 'not-a-number';
    process.env.DATABASE_POOL_MIN = '1';
    process.env.DATABASE_POOL_IDLE_TIMEOUT_MS = '30000';
    process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = '60000';

    const { getDatabasePool } = databaseModule;

    await expect(getDatabasePool()).rejects.toThrow('DATABASE_POOL_MAX must be a valid number');
  });

  it('builds connection string from DB parts when DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_SECRET_ARN;
    process.env.DB_HOST = 'db.example.com';
    process.env.DB_NAME = 'content';
    process.env.DB_USER = 'dbuser';
    process.env.DB_PASSWORD = 'secret';
    process.env.DB_PORT = '5432';
    process.env.DATABASE_POOL_MAX = '10';
    process.env.DATABASE_POOL_MIN = '2';
    process.env.DATABASE_POOL_IDLE_TIMEOUT_MS = '10000';
    process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = '20000';

    const { getDatabasePool, closeDatabasePool } = databaseModule;
    const pool = await getDatabasePool();

    expect(pool.options.connectionString).toBe(
      'postgresql://dbuser:secret@db.example.com:5432/content'
    );
    await closeDatabasePool();
  });

  it('logs pool errors for recoverable and unexpected error codes', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/app';
    process.env.DATABASE_POOL_MAX = '5';
    process.env.DATABASE_POOL_MIN = '1';
    process.env.DATABASE_POOL_IDLE_TIMEOUT_MS = '30000';
    process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = '60000';

    const { getDatabasePool, closeDatabasePool } = databaseModule;
    const pool = await getDatabasePool();

    (pool as any).emit('error', { code: '57P01' });
    let logs = consumeConsoleOutput();
    expect(logs.some(entry => entry.method === 'warn' && String(entry.args[0]).includes('57P01'))).toBe(true);

    (pool as any).emit('error', new Error('boom'));
    logs = consumeConsoleOutput();
    expect(logs.some(entry => entry.method === 'error' && String(entry.args[0]).includes('Unexpected database pool error'))).toBe(true);

    await closeDatabasePool();
  });

  it('uses Secrets Manager when DATABASE_SECRET_ARN is set and caches the result', async () => {
    process.env.DATABASE_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
    process.env.AWS_REGION = 'us-east-1';
    process.env.DATABASE_POOL_MAX = '3';
    process.env.DATABASE_POOL_MIN = '1';
    process.env.DATABASE_POOL_IDLE_TIMEOUT_MS = '30000';
    process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = '60000';

    sendMock.mockResolvedValue({
      SecretString: JSON.stringify({ connection_string: 'postgresql://secret/db' }),
    });

    const { getDatabasePool, closeDatabasePool } = databaseModule;
    const pool = await getDatabasePool();
    await getDatabasePool();

    expect(secretsClientMock).toHaveBeenCalledWith({ region: 'us-east-1' });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(getSecretValueCommandMock).toHaveBeenCalledWith({
      SecretId: process.env.DATABASE_SECRET_ARN,
    });
    expect(pool.options.connectionString).toBe('postgresql://secret/db');
    await closeDatabasePool();
  });

  it('throws when AWS_REGION is missing for Secrets Manager', async () => {
    process.env.DATABASE_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
    delete process.env.AWS_REGION;

    const { getDatabasePool } = databaseModule;

    await expect(getDatabasePool()).rejects.toThrow('AWS_REGION must be set');
  });

  it('throws when secret value is empty', async () => {
    process.env.DATABASE_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
    process.env.AWS_REGION = 'us-east-1';
    process.env.DATABASE_POOL_MAX = '3';
    process.env.DATABASE_POOL_MIN = '1';
    process.env.DATABASE_POOL_IDLE_TIMEOUT_MS = '30000';
    process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = '60000';

    sendMock.mockResolvedValue({ SecretString: '' });

    const { getDatabasePool } = databaseModule;

    await expect(getDatabasePool()).rejects.toThrow(
      'Failed to retrieve database secret: Secret value is empty'
    );
  });

  it('throws when connection_string is missing in the secret', async () => {
    process.env.DATABASE_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
    process.env.AWS_REGION = 'us-east-1';
    process.env.DATABASE_POOL_MAX = '3';
    process.env.DATABASE_POOL_MIN = '1';
    process.env.DATABASE_POOL_IDLE_TIMEOUT_MS = '30000';
    process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = '60000';

    sendMock.mockResolvedValue({
      SecretString: JSON.stringify({ not_connection_string: 'value' }),
    });

    const { getDatabasePool } = databaseModule;

    await expect(getDatabasePool()).rejects.toThrow(
      'Failed to retrieve database secret: Missing database connection values in secret or environment'
    );
  });

  it('builds connection string from secret values when connection_string is missing', async () => {
    process.env.DATABASE_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
    process.env.AWS_REGION = 'us-east-1';
    process.env.DB_HOST = 'proxy.example.com';
    process.env.DB_NAME = 'content';
    process.env.DB_PORT = '5432';
    process.env.DATABASE_POOL_MAX = '3';
    process.env.DATABASE_POOL_MIN = '1';
    process.env.DATABASE_POOL_IDLE_TIMEOUT_MS = '30000';
    process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = '60000';

    sendMock.mockResolvedValue({
      SecretString: JSON.stringify({ username: 'dbuser', password: 'secret' }),
    });

    const { getDatabasePool, closeDatabasePool } = databaseModule;
    const pool = await getDatabasePool();

    expect(pool.options.connectionString).toBe(
      'postgresql://dbuser:secret@proxy.example.com:5432/content'
    );
    await closeDatabasePool();
  });

  it('returns a noop pool in test mode when no connection settings exist', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_SECRET_ARN;
    delete process.env.DB_HOST;
    delete process.env.DB_NAME;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_PORT;

    const { getDatabasePool, resetDatabaseCache } = databaseModule;
    const pool = await getDatabasePool();
    const handler = jest.fn();
    const otherHandler = jest.fn();
    (pool as any).on('error', handler);
    (pool as any).on('notice', otherHandler);

    const client = await pool.connect();
    const result = await client.query('select 1');
    client.release();

    expect((pool as any).emit('error', new Error('noop'))).toBe(true);
    expect(handler).toHaveBeenCalledWith(expect.any(Error));
    expect(otherHandler).not.toHaveBeenCalled();
    expect((pool as any).emit('not-error', new Error('noop'))).toBe(false);

    expect(typeof pool.query).toBe('function');
    expect(pool.options).toBeUndefined();
    expect(result.rowCount).toBe(0);
    resetDatabaseCache();
  });

  it('throws when no connection settings are provided outside test mode', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_SECRET_ARN;
    delete process.env.DB_HOST;
    delete process.env.DB_NAME;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_PORT;

    const { getDatabasePool } = databaseModule;

    await expect(getDatabasePool()).rejects.toThrow(
      'Neither DATABASE_SECRET_ARN nor DATABASE_URL environment variable is set'
    );
  });

  it('re-exports database helpers from the backend index module', () => {
    const indexExports = require('../../../src/backend/src');

    expect(indexExports.getDatabasePool).toBe(databaseModule.getDatabasePool);
    expect(indexExports.setTestDatabasePool).toBe(databaseModule.setTestDatabasePool);
    expect(indexExports.closeDatabasePool).toBe(databaseModule.closeDatabasePool);
    expect(indexExports.resetDatabaseCache).toBe(databaseModule.resetDatabaseCache);
  });
});
