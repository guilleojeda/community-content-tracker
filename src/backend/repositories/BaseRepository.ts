import { Pool, PoolClient } from 'pg';

export interface FindAllOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'ASC' | 'DESC';
}

export interface FindConditions {
  [key: string]: any;
}

export interface RepositoryError extends Error {
  code?: string;
  detail?: string;
  constraint?: string;
}

/**
 * Base repository class providing common CRUD operations
 * Follows the Repository pattern for data access abstraction
 */
export abstract class BaseRepository {
  protected pool: Pool | PoolClient;
  protected tableName: string;

  constructor(pool: Pool | PoolClient, tableName: string) {
    this.pool = pool;
    this.tableName = tableName;
  }

  /**
   * Transform database row to domain object
   * Override in subclasses for specific transformations
   */
  protected transformRow(row: any): any {
    return row;
  }

  /**
   * Transform domain object to database row
   * Override in subclasses for specific transformations
   */
  protected transformData(data: any): any {
    return data;
  }

  /**
   * Build WHERE clause from conditions
   */
  protected buildWhereClause(conditions: FindConditions): { clause: string; values: any[] } {
    const keys = Object.keys(conditions);
    if (keys.length === 0) {
      return { clause: '', values: [] };
    }

    const clauses = keys.map((key, index) => `${this.escapeIdentifier(key)} = $${index + 1}`);
    const values = keys.map(key => conditions[key]);

    return {
      clause: `WHERE ${clauses.join(' AND ')}`,
      values,
    };
  }

  /**
   * Escape SQL identifiers to prevent injection
   */
  protected escapeIdentifier(identifier: string): string {
    // Basic validation - only allow alphanumeric and underscore
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
      throw new Error(`Invalid identifier: ${identifier}`);
    }
    return `"${identifier}"`;
  }

  /**
   * Execute query with error handling
   */
  protected async executeQuery(text: string, params?: any[]): Promise<any> {
    try {
      return await this.pool.query(text, params);
    } catch (error: any) {
      const repoError: RepositoryError = new Error(error.message);
      repoError.code = error.code;
      repoError.detail = error.detail;
      repoError.constraint = error.constraint;
      throw repoError;
    }
  }

  /**
   * Create a new record
   */
  async create(data: any): Promise<any> {
    const transformedData = this.transformData(data);
    const keys = Object.keys(transformedData);
    const values = Object.values(transformedData);

    const columns = keys.map(key => this.escapeIdentifier(key)).join(', ');
    const placeholders = keys.map((_, index) => `$${index + 1}`).join(', ');

    const query = `
      INSERT INTO ${this.escapeIdentifier(this.tableName)} (${columns})
      VALUES (${placeholders})
      RETURNING *
    `;

    const result = await this.executeQuery(query, values);
    return this.transformRow(result.rows[0]);
  }

  /**
   * Find a record by ID
   */
  async findById(id: string): Promise<any | null> {
    // Validate UUID format to prevent injection
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      throw new Error('Invalid UUID format');
    }

    const query = `
      SELECT * FROM ${this.escapeIdentifier(this.tableName)}
      WHERE id = $1
    `;

    const result = await this.executeQuery(query, [id]);
    return result.rows.length > 0 ? this.transformRow(result.rows[0]) : null;
  }

  /**
   * Find all records with optional filtering and pagination
   */
  async findAll(options: FindAllOptions = {}): Promise<any[]> {
    const { limit, offset, orderBy, orderDirection = 'ASC' } = options;

    let query = `SELECT * FROM ${this.escapeIdentifier(this.tableName)}`;

    const queryParts: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Add ORDER BY clause
    if (orderBy) {
      queryParts.push(`ORDER BY ${this.escapeIdentifier(orderBy)} ${orderDirection}`);
    }

    // Add LIMIT clause
    if (limit !== undefined) {
      queryParts.push(`LIMIT $${paramIndex++}`);
      values.push(limit);
    }

    // Add OFFSET clause
    if (offset !== undefined) {
      queryParts.push(`OFFSET $${paramIndex++}`);
      values.push(offset);
    }

    if (queryParts.length > 0) {
      query += ' ' + queryParts.join(' ');
    }

    const result = await this.executeQuery(query, values);
    return result.rows.map((row: any) => this.transformRow(row));
  }

  /**
   * Update a record by ID
   */
  async update(id: string, data: any): Promise<any | null> {
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      throw new Error('Invalid UUID format');
    }

    const transformedData = this.transformData(data);
    const keys = Object.keys(transformedData);
    const values = Object.values(transformedData);

    if (keys.length === 0) {
      return this.findById(id);
    }

    const setClauses = keys.map((key, index) => `${this.escapeIdentifier(key)} = $${index + 2}`);
    if (!keys.includes('updated_at')) {
      setClauses.push('updated_at = clock_timestamp()');
    }

    const query = `
      UPDATE ${this.escapeIdentifier(this.tableName)}
      SET ${setClauses.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    const result = await this.executeQuery(query, [id, ...values]);
    return result.rows.length > 0 ? this.transformRow(result.rows[0]) : null;
  }

  /**
   * Delete a record by ID
   */
  async delete(id: string): Promise<boolean> {
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      throw new Error('Invalid UUID format');
    }

    const query = `
      DELETE FROM ${this.escapeIdentifier(this.tableName)}
      WHERE id = $1
    `;

    const result = await this.executeQuery(query, [id]);
    return result.rowCount > 0;
  }

  /**
   * Find records by conditions
   */
  async findBy(conditions: FindConditions, options: FindAllOptions = {}): Promise<any[]> {
    const { clause, values } = this.buildWhereClause(conditions);
    const { limit, offset, orderBy, orderDirection = 'ASC' } = options;

    let query = `SELECT * FROM ${this.escapeIdentifier(this.tableName)} ${clause}`;

    const queryParts: string[] = [];
    let paramIndex = values.length + 1;

    // Add ORDER BY clause
    if (orderBy) {
      queryParts.push(`ORDER BY ${this.escapeIdentifier(orderBy)} ${orderDirection}`);
    }

    // Add LIMIT clause
    if (limit !== undefined) {
      queryParts.push(`LIMIT $${paramIndex++}`);
      values.push(limit);
    }

    // Add OFFSET clause
    if (offset !== undefined) {
      queryParts.push(`OFFSET $${paramIndex++}`);
      values.push(offset);
    }

    if (queryParts.length > 0) {
      query += ' ' + queryParts.join(' ');
    }

    const result = await this.executeQuery(query, values);
    return result.rows.map((row: any) => this.transformRow(row));
  }

  /**
   * Count records with optional conditions
   */
  async count(conditions: FindConditions = {}): Promise<number> {
    const { clause, values } = this.buildWhereClause(conditions);

    const query = `
      SELECT COUNT(*) as count
      FROM ${this.escapeIdentifier(this.tableName)}
      ${clause}
    `;

    const result = await this.executeQuery(query, values);
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Check if a record exists by ID
   */
  async exists(id: string): Promise<boolean> {
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return false;
    }

    const query = `
      SELECT 1 FROM ${this.escapeIdentifier(this.tableName)}
      WHERE id = $1
      LIMIT 1
    `;

    const result = await this.executeQuery(query, [id]);
    return result.rows.length > 0;
  }

  /**
   * Find first record matching conditions
   */
  async findOne(conditions: FindConditions): Promise<any | null> {
    const results = await this.findBy(conditions, { limit: 1 });
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Create multiple records in a transaction
   */
  async createMany(dataArray: any[]): Promise<any[]> {
    if (dataArray.length === 0) {
      return [];
    }

    // If we have a PoolClient (already in transaction), use it directly
    if ('release' in this.pool) {
      return this.performBulkCreate(dataArray);
    }

    // Otherwise, create a transaction
    const client = await (this.pool as Pool).connect();
    try {
      await client.query('BEGIN');

      const tempRepo = new (this.constructor as any)(client, this.tableName);
      const results = await tempRepo.performBulkCreate(dataArray);

      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Perform bulk create operation
   */
  private async performBulkCreate(dataArray: any[]): Promise<any[]> {
    const results: any[] = [];

    for (const data of dataArray) {
      const result = await this.create(data);
      results.push(result);
    }

    return results;
  }

  /**
   * Refresh a record from database (useful after updates)
   */
  async refresh(record: any): Promise<any | null> {
    if (!record?.id) {
      throw new Error('Record must have an id property');
    }

    return this.findById(record.id);
  }

  /**
   * Soft delete implementation (requires deleted_at column)
   */
  async softDelete(id: string): Promise<boolean> {
    return this.update(id, { deleted_at: new Date() }) !== null;
  }

  /**
   * Find records excluding soft deleted (requires deleted_at column)
   */
  async findAllActive(options: FindAllOptions = {}): Promise<any[]> {
    const { clause, values } = this.buildWhereClause({ deleted_at: null });
    const { limit, offset, orderBy, orderDirection = 'ASC' } = options;

    let query = `SELECT * FROM ${this.escapeIdentifier(this.tableName)} ${clause}`;

    const queryParts: string[] = [];
    let paramIndex = values.length + 1;

    if (orderBy) {
      queryParts.push(`ORDER BY ${this.escapeIdentifier(orderBy)} ${orderDirection}`);
    }

    if (limit !== undefined) {
      queryParts.push(`LIMIT $${paramIndex++}`);
      values.push(limit);
    }

    if (offset !== undefined) {
      queryParts.push(`OFFSET $${paramIndex++}`);
      values.push(offset);
    }

    if (queryParts.length > 0) {
      query += ' ' + queryParts.join(' ');
    }

    const result = await this.executeQuery(query, values);
    return result.rows.map((row: any) => this.transformRow(row));
  }
}
