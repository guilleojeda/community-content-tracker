-- 002_sprint_3_additions.sql
-- Migration: Add Sprint 3 features - soft delete, merge history, badge fixes
-- Author: AI Agent
-- Date: 2025-09-30

-- Add deleted_at column to content table for soft delete
ALTER TABLE content ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Add deleted_at column to content_urls table for soft delete
ALTER TABLE content_urls ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Create index for soft deleted content queries
CREATE INDEX IF NOT EXISTS idx_content_deleted_at ON content(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_urls_deleted_at ON content_urls(deleted_at) WHERE deleted_at IS NOT NULL;

-- Fix user_badges table column naming (awarded_date -> awarded_at)
-- Also add awarded_reason column
-- Note: If migration 001 already has awarded_at, this will be a no-op
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='user_badges' AND column_name='awarded_date') THEN
    ALTER TABLE user_badges RENAME COLUMN awarded_date TO awarded_at;
  END IF;
END $$;

ALTER TABLE user_badges ADD COLUMN IF NOT EXISTS awarded_reason TEXT;

-- Update the metadata column in user_badges to be more specific (not generic)
-- No change needed, metadata already exists

-- Create content_merge_history table for tracking content merges
CREATE TABLE IF NOT EXISTS content_merge_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_content_id UUID NOT NULL,
  merged_content_ids UUID[] NOT NULL,
  merged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  merge_reason TEXT,
  merged_metadata JSONB DEFAULT '{}',
  can_undo BOOLEAN DEFAULT true,
  undo_deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for content_merge_history
CREATE INDEX IF NOT EXISTS idx_merge_history_primary ON content_merge_history(primary_content_id);
CREATE INDEX IF NOT EXISTS idx_merge_history_merged_by ON content_merge_history(merged_by);
CREATE INDEX IF NOT EXISTS idx_merge_history_created_at ON content_merge_history(created_at);
CREATE INDEX IF NOT EXISTS idx_merge_history_undo_deadline ON content_merge_history(undo_deadline) WHERE can_undo = true;

-- Add updated_at trigger to content_merge_history
CREATE TRIGGER update_content_merge_history_updated_at BEFORE UPDATE ON content_merge_history
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create claimed_at column in content table for tracking when content was claimed
ALTER TABLE content ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- Create index for unclaimed content queries
CREATE INDEX IF NOT EXISTS idx_content_is_claimed_visibility ON content(is_claimed, visibility) WHERE is_claimed = false;

-- Add version column to content table for optimistic locking
ALTER TABLE content ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;

-- Create function to increment version on update
CREATE OR REPLACE FUNCTION increment_content_version()
RETURNS TRIGGER AS $$
BEGIN
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-increment version
CREATE TRIGGER increment_content_version_trigger
BEFORE UPDATE ON content
FOR EACH ROW
EXECUTE FUNCTION increment_content_version();

-- Add comments for new tables and columns
COMMENT ON TABLE content_merge_history IS 'Tracks content merge operations for audit trail and undo capability';
COMMENT ON COLUMN content.deleted_at IS 'Soft delete timestamp - NULL means not deleted';
COMMENT ON COLUMN content_urls.deleted_at IS 'Soft delete timestamp - NULL means not deleted';
COMMENT ON COLUMN content.claimed_at IS 'Timestamp when unclaimed content was claimed by a user';
COMMENT ON COLUMN content.version IS 'Version number for optimistic locking in concurrent updates';
COMMENT ON COLUMN user_badges.awarded_at IS 'Timestamp when badge was awarded to user';
COMMENT ON COLUMN user_badges.awarded_reason IS 'Reason or justification for awarding the badge';

-- Create view for active (non-deleted) content
CREATE OR REPLACE VIEW active_content AS
SELECT * FROM content WHERE deleted_at IS NULL;

-- Create view for recently merged content (last 30 days)
CREATE OR REPLACE VIEW recent_merges AS
SELECT
    cmh.*,
    c.title as primary_content_title,
    c.content_type as primary_content_type,
    u.username as merged_by_username
FROM content_merge_history cmh
LEFT JOIN content c ON cmh.primary_content_id = c.id
LEFT JOIN users u ON cmh.merged_by = u.id
WHERE cmh.created_at >= NOW() - INTERVAL '30 days'
ORDER BY cmh.created_at DESC;

-- Create function to soft delete content
CREATE OR REPLACE FUNCTION soft_delete_content(content_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    -- Set deleted_at timestamp on content
    UPDATE content
    SET deleted_at = NOW()
    WHERE id = content_uuid AND deleted_at IS NULL;

    -- Set deleted_at on associated URLs
    UPDATE content_urls
    SET deleted_at = NOW()
    WHERE content_id = content_uuid AND deleted_at IS NULL;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Create function to restore (undelete) content
CREATE OR REPLACE FUNCTION restore_content(content_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    -- Clear deleted_at timestamp on content
    UPDATE content
    SET deleted_at = NULL
    WHERE id = content_uuid AND deleted_at IS NOT NULL;

    -- Clear deleted_at on associated URLs
    UPDATE content_urls
    SET deleted_at = NULL
    WHERE content_id = content_uuid AND deleted_at IS NOT NULL;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION soft_delete_content(UUID) IS 'Soft deletes content and associated URLs by setting deleted_at timestamp';
COMMENT ON FUNCTION restore_content(UUID) IS 'Restores soft-deleted content by clearing deleted_at timestamp';