-- 004_create_channels_table.down.sql
-- Rollback Migration: Remove channels table and related objects
-- Author: AI Agent
-- Date: 2025-10-13

-- Drop trigger for channels updated_at
DROP TRIGGER IF EXISTS update_channels_updated_at ON channels;

-- Drop indexes for channels table
DROP INDEX IF EXISTS idx_channels_metadata;
DROP INDEX IF EXISTS idx_channels_enabled_sync_frequency;
DROP INDEX IF EXISTS idx_channels_sync_frequency;
DROP INDEX IF EXISTS idx_channels_last_sync_at;
DROP INDEX IF EXISTS idx_channels_enabled;
DROP INDEX IF EXISTS idx_channels_channel_type;
DROP INDEX IF EXISTS idx_channels_user_id;

-- Drop channels table
DROP TABLE IF EXISTS channels CASCADE;

-- Drop custom enum types created for channels
DROP TYPE IF EXISTS sync_status_enum CASCADE;
DROP TYPE IF EXISTS sync_frequency_enum CASCADE;
DROP TYPE IF EXISTS channel_type_enum CASCADE;

-- Add comment documenting the rollback
COMMENT ON SCHEMA public IS 'Rolled back 004_create_channels_table migration - channels functionality removed';
