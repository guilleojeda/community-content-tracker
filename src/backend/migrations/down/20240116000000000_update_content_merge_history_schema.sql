-- Down Migration: Revert content_merge_history schema changes

-- Remove new columns introduced for enhanced merge tracking
ALTER TABLE content_merge_history
  DROP COLUMN IF EXISTS primary_content_id,
  DROP COLUMN IF EXISTS merged_content_ids,
  DROP COLUMN IF EXISTS merge_reason,
  DROP COLUMN IF EXISTS merged_metadata,
  DROP COLUMN IF EXISTS can_undo,
  DROP COLUMN IF EXISTS undo_deadline;

-- Restore legacy columns
ALTER TABLE content_merge_history
  ADD COLUMN IF NOT EXISTS source_content_id UUID,
  ADD COLUMN IF NOT EXISTS target_content_id UUID;

-- Recreate legacy indexes
CREATE INDEX IF NOT EXISTS idx_merge_history_source ON content_merge_history(source_content_id);
CREATE INDEX IF NOT EXISTS idx_merge_history_target ON content_merge_history(target_content_id);
