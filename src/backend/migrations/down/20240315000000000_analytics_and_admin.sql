-- Rollback migration 007_analytics_and_admin.sql

-- Drop tables
DROP TABLE IF EXISTS admin_actions;
DROP TABLE IF EXISTS analytics_events;

-- Drop enums
DROP TYPE IF EXISTS event_type_enum;
