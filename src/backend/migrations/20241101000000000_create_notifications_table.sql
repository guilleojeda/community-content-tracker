-- 014_create_notifications_table.sql
-- Migration: Create notifications table for persisted user/admin alerts
-- Sprint: 8
-- Date: 2024-11-01

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(100) NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
  priority VARCHAR(16) NOT NULL DEFAULT 'low',
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE notifications IS 'Persisted notifications delivered to users/admins';
COMMENT ON COLUMN notifications.user_id IS 'Notification recipient';
COMMENT ON COLUMN notifications.type IS 'Notification category key (e.g., badge.granted)';
COMMENT ON COLUMN notifications.priority IS 'low | medium | high | urgent for sorting';

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

CREATE TRIGGER update_notifications_updated_at
BEFORE UPDATE ON notifications
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
