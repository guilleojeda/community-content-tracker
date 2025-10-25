-- 007_analytics_and_admin.sql
-- Migration: Add analytics tracking and admin dashboard support
-- Sprint: 7
-- Date: 2024-06-01

-- Create event_type enum for analytics
CREATE TYPE event_type_enum AS ENUM (
  'page_view',
  'search',
  'content_view',
  'content_click',
  'profile_view',
  'export',
  'login',
  'registration'
);

-- Create analytics_events table for tracking user interactions
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type event_type_enum NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id VARCHAR(255),
  content_id UUID REFERENCES content(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}' NOT NULL,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id ON analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_content_id ON analytics_events(content_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_session_id ON analytics_events(session_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_metadata ON analytics_events USING GIN(metadata);

-- Create admin_actions table for audit trail
CREATE TABLE IF NOT EXISTS admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type VARCHAR(100) NOT NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_content_id UUID REFERENCES content(id) ON DELETE SET NULL,
  details JSONB DEFAULT '{}' NOT NULL,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create indexes for admin actions
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_user_id ON admin_actions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_action_type ON admin_actions(action_type);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target_user_id ON admin_actions(target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at ON admin_actions(created_at DESC);

-- Add table comments
COMMENT ON TABLE analytics_events IS 'User interaction tracking for analytics and reporting';
COMMENT ON TABLE admin_actions IS 'Admin action audit trail for security and compliance';
COMMENT ON COLUMN analytics_events.event_type IS 'Type of event: page_view, search, content_view, etc.';
COMMENT ON COLUMN analytics_events.metadata IS 'Event-specific metadata (search query, page URL, etc.)';
COMMENT ON COLUMN admin_actions.action_type IS 'Type of admin action: grant_badge, revoke_badge, set_aws_employee, etc.';
COMMENT ON COLUMN admin_actions.details IS 'Action-specific details and reason';
