-- Migration: Align content_merge_history schema with merge/undo implementation

-- Drop legacy indexes that reference removed columns
DROP INDEX IF EXISTS idx_merge_history_source;
DROP INDEX IF EXISTS idx_merge_history_target;

-- Remove legacy columns no longer used by the service layer
ALTER TABLE content_merge_history
  DROP COLUMN IF EXISTS source_content_id,
  DROP COLUMN IF EXISTS target_content_id;

-- Add new columns required for merge tracking and undo support
ALTER TABLE content_merge_history
  ADD COLUMN IF NOT EXISTS primary_content_id UUID NOT NULL,
  ADD COLUMN IF NOT EXISTS merged_content_ids UUID[] NOT NULL,
  ADD COLUMN IF NOT EXISTS merge_reason TEXT,
  ADD COLUMN IF NOT EXISTS merged_metadata JSONB,
  ADD COLUMN IF NOT EXISTS can_undo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS undo_deadline TIMESTAMPTZ;

-- Add supporting indexes for common lookup patterns
CREATE INDEX IF NOT EXISTS idx_merge_history_primary ON content_merge_history(primary_content_id);
CREATE INDEX IF NOT EXISTS idx_merge_history_undo_deadline ON content_merge_history(undo_deadline);

-- Update documentation for the new columns
COMMENT ON COLUMN content_merge_history.primary_content_id IS 'Content ID that remains after a merge operation';
COMMENT ON COLUMN content_merge_history.merged_content_ids IS 'Array of content IDs merged into the primary content';
COMMENT ON COLUMN content_merge_history.merge_reason IS 'Reason provided when merging content items';
COMMENT ON COLUMN content_merge_history.merged_metadata IS 'Summary metadata captured at merge time (counts, etc)';
COMMENT ON COLUMN content_merge_history.can_undo IS 'Indicates whether the merge can still be undone';
COMMENT ON COLUMN content_merge_history.undo_deadline IS 'Timestamp after which the merge can no longer be undone';
