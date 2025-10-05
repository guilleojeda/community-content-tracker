-- 001_initial_schema.sql
-- Migration: Create initial database schema for AWS Community Content Hub
-- Author: AI Agent
-- Date: 2024-01-01

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- Create enums that match our TypeScript types exactly
CREATE TYPE visibility_enum AS ENUM ('private', 'aws_only', 'aws_community', 'public');
CREATE TYPE content_type_enum AS ENUM ('blog', 'youtube', 'github', 'conference_talk', 'podcast');
CREATE TYPE badge_enum AS ENUM ('community_builder', 'hero', 'ambassador', 'user_group_leader');

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cognito_sub VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(100) UNIQUE NOT NULL,
  profile_slug VARCHAR(100) UNIQUE NOT NULL,
  default_visibility visibility_enum NOT NULL DEFAULT 'private',
  is_admin BOOLEAN DEFAULT false,
  is_aws_employee BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Content table
CREATE TABLE content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  content_type content_type_enum NOT NULL,
  visibility visibility_enum NOT NULL,
  publish_date TIMESTAMPTZ,
  capture_date TIMESTAMPTZ DEFAULT NOW(),
  metrics JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  embedding vector(1536),
  is_claimed BOOLEAN DEFAULT true,
  original_author VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Content URLs table (normalized for better structure)
CREATE TABLE content_urls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID REFERENCES content(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(content_id, url)
);

-- User badges table (many-to-many relationship)
CREATE TABLE user_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  badge_type badge_enum NOT NULL,
  awarded_at TIMESTAMPTZ DEFAULT NOW(),
  awarded_by UUID REFERENCES users(id),
  awarded_reason TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, badge_type)
);

-- Content analytics table for performance metrics
CREATE TABLE content_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID REFERENCES content(id) ON DELETE CASCADE,
  views_count INTEGER DEFAULT 0,
  likes_count INTEGER DEFAULT 0,
  shares_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  engagement_score DECIMAL(5,2) DEFAULT 0.0,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(content_id)
);

-- User follows table for social features
CREATE TABLE user_follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(follower_id, following_id),
  CHECK (follower_id != following_id)
);

-- Content bookmarks table
CREATE TABLE content_bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  content_id UUID REFERENCES content(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, content_id)
);

-- System audit log
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance optimization

-- Users table indexes
CREATE INDEX idx_users_cognito_sub ON users(cognito_sub);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_profile_slug ON users(profile_slug);
CREATE INDEX idx_users_is_admin ON users(is_admin) WHERE is_admin = true;
CREATE INDEX idx_users_is_aws_employee ON users(is_aws_employee) WHERE is_aws_employee = true;
CREATE INDEX idx_users_created_at ON users(created_at);

-- Content table indexes
CREATE INDEX idx_content_user_id ON content(user_id);
CREATE INDEX idx_content_content_type ON content(content_type);
CREATE INDEX idx_content_visibility ON content(visibility);
CREATE INDEX idx_content_publish_date ON content(publish_date);
CREATE INDEX idx_content_capture_date ON content(capture_date);
CREATE INDEX idx_content_is_claimed ON content(is_claimed);
CREATE INDEX idx_content_tags ON content USING GIN(tags);
CREATE INDEX idx_content_metrics ON content USING GIN(metrics);
CREATE INDEX idx_content_title_fts ON content USING GIN(to_tsvector('english', title));
CREATE INDEX idx_content_description_fts ON content USING GIN(to_tsvector('english', description));

-- Vector similarity search index (for AI embeddings)
CREATE INDEX idx_content_embedding ON content USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Content URLs indexes
CREATE INDEX idx_content_urls_content_id ON content_urls(content_id);
CREATE INDEX idx_content_urls_url ON content_urls(url);

-- User badges indexes
CREATE INDEX idx_user_badges_user_id ON user_badges(user_id);
CREATE INDEX idx_user_badges_badge_type ON user_badges(badge_type);
CREATE INDEX idx_user_badges_awarded_at ON user_badges(awarded_at);

-- Content analytics indexes
CREATE INDEX idx_content_analytics_content_id ON content_analytics(content_id);
CREATE INDEX idx_content_analytics_views_count ON content_analytics(views_count);
CREATE INDEX idx_content_analytics_engagement_score ON content_analytics(engagement_score);

-- User follows indexes
CREATE INDEX idx_user_follows_follower_id ON user_follows(follower_id);
CREATE INDEX idx_user_follows_following_id ON user_follows(following_id);

-- Content bookmarks indexes
CREATE INDEX idx_content_bookmarks_user_id ON content_bookmarks(user_id);
CREATE INDEX idx_content_bookmarks_content_id ON content_bookmarks(content_id);

-- Audit log indexes
CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_resource_type ON audit_log(resource_type);
CREATE INDEX idx_audit_log_resource_id ON audit_log(resource_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);

-- Create composite indexes for common query patterns
CREATE INDEX idx_content_user_visibility ON content(user_id, visibility);
CREATE INDEX idx_content_type_visibility ON content(content_type, visibility);
CREATE INDEX idx_content_publish_visibility ON content(publish_date, visibility) WHERE publish_date IS NOT NULL;

-- Create updated_at triggers for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_content_updated_at BEFORE UPDATE ON content
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_badges_updated_at BEFORE UPDATE ON user_badges
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function for GDPR data export
CREATE OR REPLACE FUNCTION export_user_data(user_uuid UUID)
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'user', to_json(u.*),
        'content', COALESCE(content_array.content, '[]'::json),
        'badges', COALESCE(badges_array.badges, '[]'::json),
        'bookmarks', COALESCE(bookmarks_array.bookmarks, '[]'::json),
        'follows', COALESCE(follows_array.follows, '[]'::json),
        'export_date', NOW()
    ) INTO result
    FROM users u
    LEFT JOIN (
        SELECT user_id, json_agg(to_json(c.*)) as content
        FROM content c
        WHERE c.user_id = user_uuid
        GROUP BY user_id
    ) content_array ON u.id = content_array.user_id
    LEFT JOIN (
        SELECT user_id, json_agg(to_json(ub.*)) as badges
        FROM user_badges ub
        WHERE ub.user_id = user_uuid
        GROUP BY user_id
    ) badges_array ON u.id = badges_array.user_id
    LEFT JOIN (
        SELECT user_id, json_agg(to_json(cb.*)) as bookmarks
        FROM content_bookmarks cb
        WHERE cb.user_id = user_uuid
        GROUP BY user_id
    ) bookmarks_array ON u.id = bookmarks_array.user_id
    LEFT JOIN (
        SELECT follower_id as user_id, json_agg(to_json(uf.*)) as follows
        FROM user_follows uf
        WHERE uf.follower_id = user_uuid
        GROUP BY follower_id
    ) follows_array ON u.id = follows_array.user_id
    WHERE u.id = user_uuid;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Create function for GDPR data deletion
CREATE OR REPLACE FUNCTION delete_user_data(user_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    -- Delete in correct order due to foreign key constraints
    DELETE FROM content_bookmarks WHERE user_id = user_uuid;
    DELETE FROM user_follows WHERE follower_id = user_uuid OR following_id = user_uuid;
    DELETE FROM user_badges WHERE user_id = user_uuid;
    DELETE FROM content_analytics WHERE content_id IN (SELECT id FROM content WHERE user_id = user_uuid);
    DELETE FROM content_urls WHERE content_id IN (SELECT id FROM content WHERE user_id = user_uuid);
    DELETE FROM content WHERE user_id = user_uuid;

    -- Anonymize audit log entries instead of deleting them
    UPDATE audit_log SET user_id = NULL WHERE user_id = user_uuid;

    -- Finally delete the user
    DELETE FROM users WHERE id = user_uuid;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON TABLE users IS 'Core user accounts linked to Cognito identities';
COMMENT ON TABLE content IS 'User-generated content (blogs, videos, talks, etc.)';
COMMENT ON TABLE content_urls IS 'URLs associated with content items';
COMMENT ON TABLE user_badges IS 'Badges awarded to users for community contributions';
COMMENT ON TABLE content_analytics IS 'Performance metrics for content items';
COMMENT ON TABLE user_follows IS 'Social following relationships between users';
COMMENT ON TABLE content_bookmarks IS 'User bookmarks of content items';
COMMENT ON TABLE audit_log IS 'System audit trail for compliance and debugging';

COMMENT ON FUNCTION export_user_data(UUID) IS 'GDPR compliant user data export';
COMMENT ON FUNCTION delete_user_data(UUID) IS 'GDPR compliant user data deletion with referential integrity';