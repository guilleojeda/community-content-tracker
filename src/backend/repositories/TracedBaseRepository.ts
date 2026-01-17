import { Pool, PoolClient } from 'pg';
import { BaseRepository, FindAllOptions, FindConditions } from './BaseRepository';
import { tracing } from '../services/TracingService';

/**
 * Enhanced BaseRepository with distributed tracing capabilities
 * Automatically traces all database operations for performance monitoring
 */
export abstract class TracedBaseRepository extends BaseRepository {
  constructor(pool: Pool | PoolClient, tableName: string) {
    super(pool, tableName);
  }

  /**
   * Execute query with tracing
   */
  protected async executeQuery(text: string, params?: any[]): Promise<any> {
    return tracing.traceQuery(
      `${this.tableName}_query`,
      () => super.executeQuery(text, params),
      text
    );
  }

  /**
   * Create a new record with tracing
   */
  async create(data: any): Promise<any> {
    return tracing.traceRepository(
      this.tableName,
      'create',
      () => super.create(data),
      { operation: 'create', dataSize: JSON.stringify(data).length }
    );
  }

  /**
   * Find a record by ID with tracing
   */
  async findById(id: string): Promise<any | null> {
    return tracing.traceRepository(
      this.tableName,
      'findById',
      () => super.findById(id),
      { operation: 'read', recordId: id }
    );
  }

  /**
   * Find all records with tracing
   */
  async findAll(options: FindAllOptions = {}): Promise<any[]> {
    const endMeasure = tracing.measureLatency(`${this.tableName}_findAll`);

    try {
      const result = await tracing.traceRepository(
        this.tableName,
        'findAll',
        () => super.findAll(options),
        {
          operation: 'read',
          limit: options.limit,
          offset: options.offset,
          orderBy: options.orderBy,
        }
      );

      tracing.recordMetric(`${this.tableName}_findAll_count`, result.length, 'Count');
      return result;
    } finally {
      endMeasure();
    }
  }

  /**
   * Update a record by ID with tracing
   */
  async update(id: string, data: any): Promise<any | null> {
    return tracing.traceRepository(
      this.tableName,
      'update',
      () => super.update(id, data),
      {
        operation: 'update',
        recordId: id,
        dataSize: JSON.stringify(data).length,
      }
    );
  }

  /**
   * Delete a record by ID with tracing
   */
  async delete(id: string): Promise<boolean> {
    return tracing.traceRepository(
      this.tableName,
      'delete',
      () => super.delete(id),
      { operation: 'delete', recordId: id }
    );
  }

  /**
   * Find records by conditions with tracing
   */
  async findBy(conditions: FindConditions, options: FindAllOptions = {}): Promise<any[]> {
    const endMeasure = tracing.measureLatency(`${this.tableName}_findBy`);

    try {
      const result = await tracing.traceRepository(
        this.tableName,
        'findBy',
        () => super.findBy(conditions, options),
        {
          operation: 'read',
          conditions: Object.keys(conditions).join(','),
          limit: options.limit,
        }
      );

      tracing.recordMetric(`${this.tableName}_findBy_count`, result.length, 'Count');
      return result;
    } finally {
      endMeasure();
    }
  }

  /**
   * Count records with tracing
   */
  async count(conditions: FindConditions = {}): Promise<number> {
    const result = await tracing.traceRepository(
      this.tableName,
      'count',
      () => super.count(conditions),
      {
        operation: 'count',
        hasConditions: Object.keys(conditions).length > 0,
      }
    );

    tracing.recordMetric(`${this.tableName}_count_result`, result, 'Count');
    return result;
  }

  /**
   * Create multiple records in a transaction with tracing
   */
  async createMany(dataArray: any[]): Promise<any[]> {
    const endMeasure = tracing.measureLatency(`${this.tableName}_createMany`);

    try {
      const result = await tracing.traceRepository(
        this.tableName,
        'createMany',
        () => super.createMany(dataArray),
        {
          operation: 'bulk_create',
          recordCount: dataArray.length,
        }
      );

      tracing.recordMetric(`${this.tableName}_bulk_insert_count`, result.length, 'Count');
      return result;
    } finally {
      endMeasure();
    }
  }

  /**
   * Check if a record exists by ID with tracing
   */
  async exists(id: string): Promise<boolean> {
    return tracing.traceRepository(
      this.tableName,
      'exists',
      () => super.exists(id),
      { operation: 'exists', recordId: id }
    );
  }

  /**
   * Find first record matching conditions with tracing
   */
  async findOne(conditions: FindConditions): Promise<any | null> {
    return tracing.traceRepository(
      this.tableName,
      'findOne',
      () => super.findOne(conditions),
      {
        operation: 'read',
        conditions: Object.keys(conditions).join(','),
      }
    );
  }

  /**
   * Soft delete with tracing
   */
  async softDelete(id: string): Promise<boolean> {
    return tracing.traceRepository(
      this.tableName,
      'softDelete',
      () => super.softDelete(id),
      { operation: 'soft_delete', recordId: id }
    );
  }

  /**
   * Find active records with tracing
   */
  async findAllActive(options: FindAllOptions = {}): Promise<any[]> {
    const endMeasure = tracing.measureLatency(`${this.tableName}_findAllActive`);

    try {
      const result = await tracing.traceRepository(
        this.tableName,
        'findAllActive',
        () => super.findAllActive(options),
        {
          operation: 'read',
          excludeDeleted: true,
          limit: options.limit,
        }
      );

      tracing.recordMetric(`${this.tableName}_active_count`, result.length, 'Count');
      return result;
    } finally {
      endMeasure();
    }
  }

  /**
   * Monitor connection pool health
   */
  protected async checkPoolHealth(): Promise<void> {
    if ('connect' in this.pool) {
      const pool = this.pool as Pool;
      const poolMetrics = {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
      };

      tracing.addMetadata('database', 'poolMetrics', poolMetrics);

      // Record pool metrics
      tracing.recordMetric('db_pool_total', poolMetrics.totalCount, 'Count');
      tracing.recordMetric('db_pool_idle', poolMetrics.idleCount, 'Count');
      tracing.recordMetric('db_pool_waiting', poolMetrics.waitingCount, 'Count');
    }
  }

  /**
   * Perform a traced transaction
   */
  async transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
    name: string = 'transaction'
  ): Promise<T> {
    if ('release' in this.pool) {
      // Already in a transaction, just execute
      return operation(this.pool as PoolClient);
    }

    const pool = this.pool as Pool;
    const client = await pool.connect();

    return tracing.traceAsync(
      `${this.tableName}_${name}`,
      async () => {
        try {
          await client.query('BEGIN');
          const result = await operation(client);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          tracing.recordError(error as Error, {
            repository: this.tableName,
            transaction: name,
          });
          throw error;
        } finally {
          client.release();
        }
      },
      { operation: 'transaction', transactionName: name }
    );
  }

  /**
   * Get repository performance statistics
   */
  async getPerformanceStats(): Promise<{
    tableName: string;
    rowCount: number;
    averageRowSize?: number;
    indexCount?: number;
  }> {
    const stats: {
      tableName: string;
      rowCount: number;
      averageRowSize?: number;
      indexCount?: number;
    } = {
      tableName: this.tableName,
      rowCount: await this.count(),
    };

    // Additional statistics query (PostgreSQL specific)
    try {
      const statsQuery = `
        SELECT
          pg_relation_size($1) as table_size,
          (SELECT COUNT(*) FROM pg_indexes WHERE tablename = $1) as index_count
      `;

      const result = await this.executeQuery(statsQuery, [this.tableName]);
      if (result.rows.length > 0) {
        const row = result.rows[0];
        stats.averageRowSize = stats.rowCount > 0
          ? Math.round(parseInt(row.table_size, 10) / stats.rowCount)
          : 0;
        stats.indexCount = parseInt(row.index_count, 10);
      }
    } catch (error) {
      // Statistics query failed, but that's okay
      console.warn(`Failed to get detailed stats for ${this.tableName}:`, error);
    }

    tracing.addMetadata('repository', `${this.tableName}_stats`, stats);
    return stats;
  }
}
