-- 004_create_channels_table.sql
-- Migration: Create channels table for content ingestion sources
-- Sprint: 4
-- Date: 2024-01-15
--
-- NOTE: Migration 003 intentionally skipped.
-- Sprint 3 database changes were fully covered by migration 002_sprint_3_additions.sql
-- (soft delete, merge history, content claiming, optimistic locking, etc.).
-- This migration introduces Sprint 4 features: content ingestion channels.

-- Create channel_type enum
CREATE TYPE channel_type_enum AS ENUM ('blog', 'youtube', 'github');

-- Create sync_frequency enum
CREATE TYPE sync_frequency_enum AS ENUM ('daily', 'weekly', 'manual');

-- Create sync_status enum
CREATE TYPE sync_status_enum AS ENUM ('success', 'error');

-- Create channels table
CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_type channel_type_enum NOT NULL,
  url TEXT NOT NULL,
  name VARCHAR(255),
  enabled BOOLEAN DEFAULT true NOT NULL,
  last_sync_at TIMESTAMPTZ,
  last_sync_status sync_status_enum,
  last_sync_error TEXT,
  sync_frequency sync_frequency_enum DEFAULT 'daily' NOT NULL,
  metadata JSONB DEFAULT '{}' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, url)
);

-- Create indexes for performance
CREATE INDEX idx_channels_user_id ON channels(user_id);
CREATE INDEX idx_channels_channel_type ON channels(channel_type);
CREATE INDEX idx_channels_enabled ON channels(enabled) WHERE enabled = true;
CREATE INDEX idx_channels_last_sync_at ON channels(last_sync_at);
CREATE INDEX idx_channels_sync_frequency ON channels(sync_frequency);
CREATE INDEX idx_channels_enabled_sync_frequency ON channels(enabled, sync_frequency) WHERE enabled = true;
CREATE INDEX idx_channels_metadata ON channels USING GIN(metadata);

-- Create trigger for automatic updated_at
CREATE TRIGGER update_channels_updated_at BEFORE UPDATE ON channels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comment for documentation
COMMENT ON TABLE channels IS 'Content source channels for automated ingestion (blogs, YouTube, GitHub)';
COMMENT ON COLUMN channels.channel_type IS 'Type of channel: blog, youtube, or github';
COMMENT ON COLUMN channels.sync_frequency IS 'How often to sync: daily, weekly, or manual';
COMMENT ON COLUMN channels.last_sync_status IS 'Status of last sync attempt: success or error';
COMMENT ON COLUMN channels.metadata IS 'Channel-specific metadata (e.g., playlist ID, repo topics)';
