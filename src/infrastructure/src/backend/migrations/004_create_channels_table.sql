-- Migration: Create channels table for content source tracking
-- Sprint 4: Content Ingestion Pipeline
-- Task 4.6: Channel Management API

-- Create enum types for channel-related fields
CREATE TYPE channel_type_enum AS ENUM ('blog', 'youtube', 'github');
CREATE TYPE sync_status_enum AS ENUM ('success', 'error');
CREATE TYPE sync_frequency_enum AS ENUM ('daily', 'weekly', 'manual');

-- Create channels table
CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_type channel_type_enum NOT NULL,
  url TEXT NOT NULL,
  name TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  last_sync_status sync_status_enum,
  last_sync_error TEXT,
  sync_frequency sync_frequency_enum NOT NULL DEFAULT 'daily',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX idx_channels_user_id ON channels(user_id);
CREATE INDEX idx_channels_type ON channels(channel_type);
CREATE INDEX idx_channels_enabled ON channels(enabled);
CREATE INDEX idx_channels_type_enabled ON channels(channel_type, enabled);
CREATE INDEX idx_channels_last_sync ON channels(last_sync_at) WHERE enabled = true;
CREATE INDEX idx_channels_user_url ON channels(user_id, url);

-- Create unique constraint for user+url combination
CREATE UNIQUE INDEX idx_channels_user_url_unique ON channels(user_id, url);

-- Create trigger to automatically update updated_at timestamp
CREATE TRIGGER update_channels_updated_at
  BEFORE UPDATE ON channels
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE channels IS 'Content source channels for automated scraping';
COMMENT ON COLUMN channels.id IS 'Unique identifier for the channel';
COMMENT ON COLUMN channels.user_id IS 'Owner of this channel';
COMMENT ON COLUMN channels.channel_type IS 'Type of content source (blog, youtube, github)';
COMMENT ON COLUMN channels.url IS 'URL of the content source';
COMMENT ON COLUMN channels.name IS 'Optional display name for the channel';
COMMENT ON COLUMN channels.enabled IS 'Whether this channel should be actively scraped';
COMMENT ON COLUMN channels.last_sync_at IS 'Timestamp of last successful sync';
COMMENT ON COLUMN channels.last_sync_status IS 'Status of last sync attempt';
COMMENT ON COLUMN channels.last_sync_error IS 'Error message from last failed sync';
COMMENT ON COLUMN channels.sync_frequency IS 'How often this channel should be synced';
COMMENT ON COLUMN channels.metadata IS 'Additional channel-specific configuration';
