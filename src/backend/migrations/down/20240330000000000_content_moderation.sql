-- Rollback Migration 008: Content Moderation

-- Drop indexes
DROP INDEX IF EXISTS idx_content_is_flagged;
DROP INDEX IF EXISTS idx_content_moderation_status;
DROP INDEX IF EXISTS idx_content_flagged_at;

-- Drop columns from content table
ALTER TABLE content DROP COLUMN IF EXISTS is_flagged;
ALTER TABLE content DROP COLUMN IF EXISTS flagged_at;
ALTER TABLE content DROP COLUMN IF EXISTS flagged_by;
ALTER TABLE content DROP COLUMN IF EXISTS flag_reason;
ALTER TABLE content DROP COLUMN IF EXISTS moderation_status;
ALTER TABLE content DROP COLUMN IF EXISTS moderated_at;
ALTER TABLE content DROP COLUMN IF EXISTS moderated_by;
