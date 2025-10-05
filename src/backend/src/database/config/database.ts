import { Pool, PoolConfig, PoolClient } from 'pg';
import { config } from 'dotenv';

// Load environment variables
config();

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  min?: number;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export class DatabaseConnection {
  private static instance: DatabaseConnection;
  private pool: Pool;

  private constructor() {
    const databaseUrl = process.env.DATABASE_URL;

    if (databaseUrl) {
      // Parse DATABASE_URL (for production/Docker environments)
      this.pool = new Pool({
        connectionString: databaseUrl,
        min: parseInt(process.env.DATABASE_POOL_MIN || '2'),
        max: parseInt(process.env.DATABASE_POOL_MAX || '10'),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });
    } else {
      // Individual config values (for development)
      const poolConfig: PoolConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'contenthub',
        user: process.env.DB_USER || 'contentuser',
        password: process.env.DB_PASSWORD || 'your-secure-password',
        min: parseInt(process.env.DATABASE_POOL_MIN || '2'),
        max: parseInt(process.env.DATABASE_POOL_MAX || '10'),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      };

      this.pool = new Pool(poolConfig);
    }

    // Handle pool errors
    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
      process.exit(-1);
    });

    // Log connection events in development
    if (process.env.NODE_ENV === 'development') {
      this.pool.on('connect', () => {
        console.log('Connected to PostgreSQL database');
      });

      this.pool.on('remove', () => {
        console.log('Client removed from pool');
      });
    }
  }

  public static getInstance(): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection();
    }
    return DatabaseConnection.instance;
  }

  public getPool(): Pool {
    return this.pool;
  }

  public async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  public async query(text: string, params?: any[]): Promise<any> {
    const start = Date.now();
    try {
      const res = await this.pool.query(text, params);
      const duration = Date.now() - start;

      if (process.env.NODE_ENV === 'development') {
        console.log('Query executed:', { text, duration, rows: res.rowCount });
      }

      return res;
    } catch (error) {
      const duration = Date.now() - start;
      console.error('Query error:', { text, duration, error });
      throw error;
    }
  }

  public async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async end(): Promise<void> {
    await this.pool.end();
  }

  public async healthCheck(): Promise<boolean> {
    try {
      const result = await this.query('SELECT 1 as healthy');
      return result.rows[0].healthy === 1;
    } catch (error) {
      console.error('Database health check failed:', error);
      return false;
    }
  }
}

// Export singleton instance
const dbConnection = DatabaseConnection.getInstance();
export const db = dbConnection.getPool();
export const getClient = () => dbConnection.getClient();
export const query = (text: string, params?: any[]) => dbConnection.query(text, params);
export const transaction = <T>(callback: (client: PoolClient) => Promise<T>) => dbConnection.transaction(callback);
export default db;