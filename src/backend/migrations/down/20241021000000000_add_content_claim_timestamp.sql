-- Down migration for 012_add_content_claim_timestamp.sql
ALTER TABLE content
  DROP COLUMN IF EXISTS claimed_at;

DROP INDEX IF EXISTS idx_content_claimed_at;
