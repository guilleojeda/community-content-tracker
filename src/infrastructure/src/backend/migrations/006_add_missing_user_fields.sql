-- 006_add_missing_user_fields.sql
-- Migration: Add social links and MFA fields
-- Sprint: 6.5
-- Date: 2024-05-01

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS social_links JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_social_links ON users USING GIN(social_links);

COMMENT ON COLUMN users.social_links IS 'User social media links';
COMMENT ON COLUMN users.mfa_enabled IS 'MFA enabled status';
