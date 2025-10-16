-- 005_add_user_profile_fields.sql
-- Migration: Add user profile and notification preference fields
-- Sprint: 6
-- Date: 2024-04-01

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS receive_newsletter BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS receive_content_notifications BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS receive_community_updates BOOLEAN DEFAULT false;

COMMENT ON COLUMN users.bio IS 'User biography';
COMMENT ON COLUMN users.receive_newsletter IS 'Newsletter preference';
COMMENT ON COLUMN users.receive_content_notifications IS 'Content notifications preference';
COMMENT ON COLUMN users.receive_community_updates IS 'Community updates preference';
