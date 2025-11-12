-- Down migration for 014_create_notifications_table.sql
DROP TRIGGER IF EXISTS update_notifications_updated_at ON notifications;
DROP TABLE IF EXISTS notifications;
