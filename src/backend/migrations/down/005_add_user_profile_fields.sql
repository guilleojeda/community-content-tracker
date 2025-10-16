-- 005_add_user_profile_fields.down.sql
-- Rollback Migration: Remove user profile and preference fields added in Sprint 6
-- Author: AI Agent
-- Date: 2025-10-13

-- Remove columns added to users table
ALTER TABLE users
  DROP COLUMN IF EXISTS receive_community_updates,
  DROP COLUMN IF EXISTS receive_content_notifications,
  DROP COLUMN IF EXISTS receive_newsletter,
  DROP COLUMN IF EXISTS bio;

-- Add comment documenting the rollback
COMMENT ON TABLE users IS 'Rolled back Sprint 6 profile additions - removed bio and notification preference fields';
