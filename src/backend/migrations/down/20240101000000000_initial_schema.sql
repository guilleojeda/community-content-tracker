-- 001_initial_schema.down.sql
-- Rollback Migration: Reverse all changes from initial schema creation
-- Author: AI Agent
-- Date: 2025-10-13
-- WARNING: This will drop ALL tables and data. Use with extreme caution in production.

-- Drop views first (dependent on tables)
DROP VIEW IF EXISTS recent_merges CASCADE;
DROP VIEW IF EXISTS active_content CASCADE;

-- Drop functions that reference tables
DROP FUNCTION IF EXISTS delete_user_data(UUID) CASCADE;
DROP FUNCTION IF EXISTS export_user_data(UUID) CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- Drop triggers (will be dropped with tables, but explicit is safer)
DROP TRIGGER IF EXISTS update_user_badges_updated_at ON user_badges;
DROP TRIGGER IF EXISTS update_content_updated_at ON content;
DROP TRIGGER IF EXISTS update_users_updated_at ON users;

-- Drop tables in reverse dependency order (foreign keys first)
-- Start with tables that have foreign keys to other tables
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS content_bookmarks CASCADE;
DROP TABLE IF EXISTS user_follows CASCADE;
DROP TABLE IF EXISTS content_analytics CASCADE;
DROP TABLE IF EXISTS user_badges CASCADE;
DROP TABLE IF EXISTS content_urls CASCADE;
DROP TABLE IF EXISTS content CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Drop custom enum types
DROP TYPE IF EXISTS badge_enum CASCADE;
DROP TYPE IF EXISTS content_type_enum CASCADE;
DROP TYPE IF EXISTS visibility_enum CASCADE;

-- Drop extensions (be careful - these might be used by other schemas)
-- Only drop if no other objects depend on them
DROP EXTENSION IF EXISTS pg_trgm CASCADE;
DROP EXTENSION IF EXISTS vector CASCADE;

-- Add comment documenting the rollback
COMMENT ON SCHEMA public IS 'Rolled back 001_initial_schema migration - all tables and objects removed';
