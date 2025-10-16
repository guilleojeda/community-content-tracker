-- 002_sprint_3_additions.sql
-- Migration: Add Sprint 3 features - soft delete and content merge history
-- Sprint: 3
-- Date: 2024-02-01

-- Add deleted_at column to content table for soft delete
ALTER TABLE content ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Add deleted_at column to content_urls table for soft delete
ALTER TABLE content_urls ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Create index for soft deleted content queries
CREATE INDEX IF NOT EXISTS idx_content_deleted_at ON content(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_urls_deleted_at ON content_urls(deleted_at) WHERE deleted_at IS NOT NULL;

-- Create content_merge_history table for tracking content merges
-- Schema matches test expectations in database-real.test.ts
CREATE TABLE IF NOT EXISTS content_merge_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_content_id UUID NOT NULL,
  target_content_id UUID NOT NULL,
  merged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  merged_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  unmerged_at TIMESTAMPTZ,
  unmerged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create indexes for content_merge_history
CREATE INDEX IF NOT EXISTS idx_merge_history_source ON content_merge_history(source_content_id);
CREATE INDEX IF NOT EXISTS idx_merge_history_target ON content_merge_history(target_content_id);
CREATE INDEX IF NOT EXISTS idx_merge_history_merged_by ON content_merge_history(merged_by);
CREATE INDEX IF NOT EXISTS idx_merge_history_merged_at ON content_merge_history(merged_at);

-- Add updated_at trigger to content_merge_history
CREATE TRIGGER update_content_merge_history_updated_at BEFORE UPDATE ON content_merge_history
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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

-- Add comments for new tables and columns
COMMENT ON TABLE content_merge_history IS 'Tracks content merge operations with source and target content IDs';
COMMENT ON COLUMN content.deleted_at IS 'Soft delete timestamp - NULL means not deleted';
COMMENT ON COLUMN content_urls.deleted_at IS 'Soft delete timestamp - NULL means not deleted';
COMMENT ON COLUMN content_merge_history.source_content_id IS 'Content ID that was merged into target';
COMMENT ON COLUMN content_merge_history.target_content_id IS 'Content ID that source was merged into';
COMMENT ON COLUMN content_merge_history.unmerged_at IS 'Timestamp when merge was undone';
COMMENT ON COLUMN content_merge_history.unmerged_by IS 'User who undid the merge';

COMMENT ON FUNCTION soft_delete_content(UUID) IS 'Soft deletes content and associated URLs by setting deleted_at timestamp';
COMMENT ON FUNCTION restore_content(UUID) IS 'Restores soft-deleted content by clearing deleted_at timestamp';
