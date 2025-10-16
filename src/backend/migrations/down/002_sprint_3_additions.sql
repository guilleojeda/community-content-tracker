-- 002_sprint_3_additions.down.sql
-- Rollback Migration: Reverse Sprint 3 additions (soft delete, merge history, badge fixes)
-- Author: AI Agent
-- Date: 2025-10-13

-- Drop functions added in this migration
DROP FUNCTION IF EXISTS restore_content(UUID) CASCADE;
DROP FUNCTION IF EXISTS soft_delete_content(UUID) CASCADE;
DROP FUNCTION IF EXISTS increment_content_version() CASCADE;

-- Drop views added in this migration
DROP VIEW IF EXISTS recent_merges CASCADE;
DROP VIEW IF EXISTS active_content CASCADE;

-- Drop trigger for content version increment
DROP TRIGGER IF EXISTS increment_content_version_trigger ON content;

-- Drop trigger for content_merge_history updated_at
DROP TRIGGER IF EXISTS update_content_merge_history_updated_at ON content_merge_history;

-- Drop indexes added in this migration
DROP INDEX IF EXISTS idx_content_is_claimed_visibility;
DROP INDEX IF EXISTS idx_merge_history_undo_deadline;
DROP INDEX IF EXISTS idx_merge_history_created_at;
DROP INDEX IF EXISTS idx_merge_history_merged_by;
DROP INDEX IF EXISTS idx_merge_history_primary;
DROP INDEX IF EXISTS idx_content_urls_deleted_at;
DROP INDEX IF EXISTS idx_content_deleted_at;

-- Drop content_merge_history table
DROP TABLE IF EXISTS content_merge_history CASCADE;

-- Remove columns added to existing tables

-- Remove version column from content table
ALTER TABLE content DROP COLUMN IF EXISTS version;

-- Remove claimed_at column from content table
ALTER TABLE content DROP COLUMN IF EXISTS claimed_at;

-- Remove awarded_reason column from user_badges (if it was added by this migration)
-- Note: If migration 001 already had this, we should not drop it
-- Check if column exists and was added by this migration
DO $$
BEGIN
  -- Only drop awarded_reason if it was added in this migration
  -- This is safe because migration 001 didn't have it originally
  ALTER TABLE user_badges DROP COLUMN IF EXISTS awarded_reason;
END $$;

-- Revert column rename (awarded_at -> awarded_date)
-- Note: Migration 001 already has awarded_at, so we don't need to rename back
-- This is a no-op for the standard case

-- Remove deleted_at column from content_urls table
ALTER TABLE content_urls DROP COLUMN IF EXISTS deleted_at;

-- Remove deleted_at column from content table
ALTER TABLE content DROP COLUMN IF EXISTS deleted_at;

-- Add comment documenting the rollback
COMMENT ON TABLE content IS 'Rolled back Sprint 3 additions - removed soft delete and merge tracking features';
