-- Migration 008: Content Moderation
-- Add flagged column to content table for moderation

-- Add flagged columns to content table
ALTER TABLE content ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE content ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMPTZ;
ALTER TABLE content ADD COLUMN IF NOT EXISTS flagged_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE content ADD COLUMN IF NOT EXISTS flag_reason TEXT;

-- Add moderation status and history
ALTER TABLE content ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(50) DEFAULT 'approved' NOT NULL;
ALTER TABLE content ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;
ALTER TABLE content ADD COLUMN IF NOT EXISTS moderated_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Create index for flagged content queries
CREATE INDEX IF NOT EXISTS idx_content_is_flagged ON content(is_flagged) WHERE is_flagged = true;
CREATE INDEX IF NOT EXISTS idx_content_moderation_status ON content(moderation_status);
CREATE INDEX IF NOT EXISTS idx_content_flagged_at ON content(flagged_at DESC) WHERE flagged_at IS NOT NULL;

-- Add comments
COMMENT ON COLUMN content.is_flagged IS 'Whether content has been flagged for review';
COMMENT ON COLUMN content.flagged_at IS 'Timestamp when content was flagged';
COMMENT ON COLUMN content.flagged_by IS 'User ID of admin who flagged the content';
COMMENT ON COLUMN content.flag_reason IS 'Reason why content was flagged';
COMMENT ON COLUMN content.moderation_status IS 'Moderation status: approved, flagged, removed';
COMMENT ON COLUMN content.moderated_at IS 'Timestamp of last moderation action';
COMMENT ON COLUMN content.moderated_by IS 'User ID of admin who performed moderation action';
