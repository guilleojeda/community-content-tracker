-- 006_add_missing_user_fields.sql
-- Migration: Add social links and MFA fields to users table
-- Sprint: 6.5
-- Date: 2024-05-01

-- Add social links and MFA fields to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS social_links JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT false;

-- Add index for social links (for efficient querying)
CREATE INDEX IF NOT EXISTS idx_users_social_links ON users USING GIN(social_links);

-- Add comments for documentation
COMMENT ON COLUMN users.social_links IS 'User social media links (twitter, linkedin, github, website) stored as JSONB';
COMMENT ON COLUMN users.mfa_enabled IS 'Whether multi-factor authentication is enabled for this user';
