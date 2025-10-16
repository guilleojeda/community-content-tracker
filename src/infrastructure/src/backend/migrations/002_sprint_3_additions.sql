-- 002_sprint_3_additions.sql
-- Migration: Add Sprint 3 features - soft delete and content merge history
-- Sprint: 3
-- Date: 2024-02-01

-- Add deleted_at columns for soft delete
ALTER TABLE content ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE content_urls ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Create indexes for soft deleted content
CREATE INDEX IF NOT EXISTS idx_content_deleted_at ON content(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_urls_deleted_at ON content_urls(deleted_at) WHERE deleted_at IS NOT NULL;

-- Create content_merge_history table matching test expectations
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

-- Add trigger for updated_at
CREATE TRIGGER update_content_merge_history_updated_at BEFORE UPDATE ON content_merge_history
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Soft delete function
CREATE OR REPLACE FUNCTION soft_delete_content(content_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE content SET deleted_at = NOW() WHERE id = content_uuid AND deleted_at IS NULL;
    UPDATE content_urls SET deleted_at = NOW() WHERE content_id = content_uuid AND deleted_at IS NULL;
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Restore function
CREATE OR REPLACE FUNCTION restore_content(content_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE content SET deleted_at = NULL WHERE id = content_uuid AND deleted_at IS NOT NULL;
    UPDATE content_urls SET deleted_at = NULL WHERE content_id = content_uuid AND deleted_at IS NOT NULL;
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON TABLE content_merge_history IS 'Tracks content merge operations';
COMMENT ON COLUMN content.deleted_at IS 'Soft delete timestamp';
COMMENT ON COLUMN content_urls.deleted_at IS 'Soft delete timestamp';
COMMENT ON FUNCTION soft_delete_content(UUID) IS 'Soft deletes content';
COMMENT ON FUNCTION restore_content(UUID) IS 'Restores soft-deleted content';
