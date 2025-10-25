-- 013_saved_searches.sql
-- Migration: Add saved searches functionality
-- Sprint: 7
-- Task: 7.7
-- Date: 2024-10-17

-- Create saved_searches table for storing user search queries
CREATE TABLE IF NOT EXISTS saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  query TEXT NOT NULL,
  filters JSONB DEFAULT '{}' NOT NULL,
  is_public BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create indexes for saved searches queries
CREATE INDEX IF NOT EXISTS idx_saved_searches_user_id ON saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_is_public ON saved_searches(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_saved_searches_created_at ON saved_searches(created_at DESC);

-- Add table comments
COMMENT ON TABLE saved_searches IS 'User-saved search queries with filters for quick access';
COMMENT ON COLUMN saved_searches.name IS 'User-friendly name for the saved search';
COMMENT ON COLUMN saved_searches.query IS 'The search query text';
COMMENT ON COLUMN saved_searches.filters IS 'Additional search filters (content_type, visibility, date ranges)';
COMMENT ON COLUMN saved_searches.is_public IS 'Whether the search is publicly visible (for sharing)';
