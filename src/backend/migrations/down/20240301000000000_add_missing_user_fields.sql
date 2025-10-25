-- 006_add_missing_user_fields.down.sql
-- Rollback migration: Remove social_links and mfa_enabled fields
-- Date: 2025-10-14

-- Drop index
DROP INDEX IF EXISTS idx_users_social_links;

-- Remove added columns
ALTER TABLE users
  DROP COLUMN IF EXISTS social_links,
  DROP COLUMN IF EXISTS mfa_enabled;

-- Note: Cannot remove enum values in PostgreSQL without recreating the entire type
-- This would require dropping all tables/columns that use the enum, which is too destructive
-- In practice, having extra enum values is harmless
-- If you absolutely need to remove them, you would need to:
-- 1. Create a new enum type without the values
-- 2. Alter all columns to use the new type
-- 3. Drop the old type
-- This is not included here to avoid data loss
