-- 012_add_content_claim_timestamp.sql
-- Migration: Add claimed_at column for content claim tracking
-- Sprint: 8
-- Date: 2025-10-21

ALTER TABLE content
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_content_claimed_at ON content(claimed_at);

COMMENT ON COLUMN content.claimed_at IS 'Timestamp when content was claimed by a contributor';
