import { Pool } from 'pg';
import { BaseRepository } from './BaseRepository';
import { Channel, ChannelType, CreateChannelRequest, UpdateChannelRequest } from '../../shared/types';

interface ChannelRow {
  id: string;
  user_id: string;
  channel_type: string;
  url: string;
  name: string | null;
  enabled: boolean;
  last_sync_at: Date | null;
  last_sync_status: 'success' | 'error' | null;
  last_sync_error: string | null;
  sync_frequency: 'daily' | 'weekly' | 'manual';
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export class ChannelRepository extends BaseRepository {
  constructor(pool: Pool) {
    super(pool, 'channels');
  }

  private mapRowToChannel(row: ChannelRow): Channel {
    return {
      id: row.id,
      userId: row.user_id,
      channelType: row.channel_type as ChannelType,
      url: row.url,
      name: row.name || undefined,
      enabled: row.enabled,
      lastSyncAt: row.last_sync_at || undefined,
      lastSyncStatus: row.last_sync_status || undefined,
      lastSyncError: row.last_sync_error || undefined,
      syncFrequency: row.sync_frequency,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async create(data: Omit<CreateChannelRequest, 'userId'> & { userId: string; enabled?: boolean }): Promise<Channel> {
    const existing = await this.findByUserIdAndUrl(data.userId, data.url);
    if (existing) {
      return existing;
    }

    try {
      const result = await this.pool.query<ChannelRow>(
        `INSERT INTO channels (user_id, channel_type, url, name, enabled, sync_frequency, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          data.userId,
          data.channelType,
          data.url,
          data.name || null,
          data.enabled !== undefined ? data.enabled : true,
          data.syncFrequency || 'daily',
          JSON.stringify(data.metadata || {}),
        ]
      );

      return this.mapRowToChannel(result.rows[0]);
    } catch (error: any) {
      if (error?.code === '23505') {
        const duplicate = await this.findByUserIdAndUrl(data.userId, data.url);
        if (duplicate) {
          return duplicate;
        }
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Channel | null> {
    const result = await this.pool.query<ChannelRow>(
      'SELECT * FROM channels WHERE id = $1',
      [id]
    );

    return result.rows.length > 0 ? this.mapRowToChannel(result.rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<Channel[]> {
    const result = await this.pool.query<ChannelRow>(
      'SELECT * FROM channels WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    return result.rows.map(row => this.mapRowToChannel(row));
  }

  async findActiveByType(channelType: ChannelType): Promise<Channel[]> {
    const result = await this.pool.query<ChannelRow>(
      'SELECT * FROM channels WHERE channel_type = $1 AND enabled = true ORDER BY last_sync_at ASC NULLS FIRST',
      [channelType]
    );

    return result.rows.map(row => this.mapRowToChannel(row));
  }

  async findByUserIdAndUrl(userId: string, url: string): Promise<Channel | null> {
    const result = await this.pool.query<ChannelRow>(
      'SELECT * FROM channels WHERE user_id = $1 AND url = $2',
      [userId, url]
    );

    return result.rows.length > 0 ? this.mapRowToChannel(result.rows[0]) : null;
  }

  async update(id: string, data: UpdateChannelRequest): Promise<Channel | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }

    if (data.enabled !== undefined) {
      updates.push(`enabled = $${paramIndex++}`);
      values.push(data.enabled);
    }

    if (data.syncFrequency !== undefined) {
      updates.push(`sync_frequency = $${paramIndex++}`);
      values.push(data.syncFrequency);
    }

    if (data.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(data.metadata));
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    values.push(id);

    const result = await this.pool.query<ChannelRow>(
      `UPDATE channels SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    return result.rows.length > 0 ? this.mapRowToChannel(result.rows[0]) : null;
  }

  async updateSyncStatus(
    id: string,
    status: 'success' | 'error',
    errorMessage?: string
  ): Promise<Channel | null> {
    const result = await this.pool.query<ChannelRow>(
      `UPDATE channels
       SET last_sync_at = NOW(),
           last_sync_status = $1,
           last_sync_error = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [status, errorMessage || null, id]
    );

    return result.rows.length > 0 ? this.mapRowToChannel(result.rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM channels WHERE id = $1',
      [id]
    );

    return (result.rowCount ?? 0) > 0;
  }

  async findAllActiveForSync(syncFrequency: 'daily' | 'weekly'): Promise<Channel[]> {
    const result = await this.pool.query<ChannelRow>(
      `SELECT * FROM channels
       WHERE enabled = true AND sync_frequency = $1
       ORDER BY last_sync_at ASC NULLS FIRST`,
      [syncFrequency]
    );

    return result.rows.map(row => this.mapRowToChannel(row));
  }
}
