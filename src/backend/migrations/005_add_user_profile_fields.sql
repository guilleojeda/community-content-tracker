-- 005_add_user_profile_fields.sql
-- Migration: Add user profile and notification preference fields
-- Sprint: 6
-- Date: 2024-04-01

-- Add profile and preference fields to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS receive_newsletter BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS receive_content_notifications BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS receive_community_updates BOOLEAN DEFAULT false;

-- Add comments for documentation
COMMENT ON COLUMN users.bio IS 'User biography or profile description';
COMMENT ON COLUMN users.receive_newsletter IS 'User preference for receiving newsletter emails';
COMMENT ON COLUMN users.receive_content_notifications IS 'User preference for receiving content update notifications';
COMMENT ON COLUMN users.receive_community_updates IS 'User preference for receiving community update notifications';
