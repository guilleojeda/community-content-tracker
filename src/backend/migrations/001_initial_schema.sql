-- 001_initial_schema.sql
-- Migration: Create initial database schema for AWS Community Content Hub
-- Sprint: 1-2
-- Date: 2024-01-01

-- Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create enums that match TypeScript types exactly (from src/shared/types/index.ts)
CREATE TYPE visibility_enum AS ENUM ('private', 'aws_only', 'aws_community', 'public');
CREATE TYPE content_type_enum AS ENUM ('blog', 'youtube', 'github', 'conference_talk', 'podcast', 'social', 'whitepaper', 'tutorial', 'workshop', 'book');
CREATE TYPE badge_enum AS ENUM ('community_builder', 'hero', 'ambassador', 'user_group_leader');

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cognito_sub VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(100) UNIQUE NOT NULL,
  profile_slug VARCHAR(100) UNIQUE NOT NULL,
  default_visibility visibility_enum NOT NULL DEFAULT 'private',
  is_admin BOOLEAN DEFAULT false NOT NULL,
  is_aws_employee BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
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
  capture_date TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  metrics JSONB DEFAULT '{}' NOT NULL,
  tags TEXT[] DEFAULT '{}' NOT NULL,
  embedding vector(1536),
  is_claimed BOOLEAN DEFAULT true NOT NULL,
  original_author VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Content URLs table (normalized for multiple URLs per content)
CREATE TABLE content_urls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID REFERENCES content(id) ON DELETE CASCADE NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(content_id, url)
);

-- Content bookmarks table
CREATE TABLE content_bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  content_id UUID REFERENCES content(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, content_id)
);

-- User follows table
CREATE TABLE user_follows (
  follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (follower_id, following_id)
);

-- Content analytics table
CREATE TABLE IF NOT EXISTS content_analytics (
  content_id UUID PRIMARY KEY REFERENCES content(id) ON DELETE CASCADE,
  views_count INTEGER DEFAULT 0,
  likes_count INTEGER DEFAULT 0,
  shares_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  engagement_score NUMERIC DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- User badges table
CREATE TABLE user_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  badge_type badge_enum NOT NULL,
  awarded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  awarded_by UUID REFERENCES users(id),
  awarded_reason TEXT,
  metadata JSONB DEFAULT '{}' NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id),
  revoke_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, badge_type)
);

-- Audit log table for compliance and security
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
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
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
CREATE INDEX idx_content_description_fts ON content USING GIN(to_tsvector('english', COALESCE(description, '')));

-- Vector similarity search index (for semantic search with embeddings)
CREATE INDEX idx_content_embedding ON content USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Composite indexes for common query patterns
CREATE INDEX idx_content_user_visibility ON content(user_id, visibility);
CREATE INDEX idx_content_type_visibility ON content(content_type, visibility);
CREATE INDEX idx_content_publish_visibility ON content(publish_date, visibility) WHERE publish_date IS NOT NULL;

-- Content URLs indexes
CREATE INDEX idx_content_urls_content_id ON content_urls(content_id);
CREATE INDEX idx_content_urls_url ON content_urls(url);

-- Content bookmarks indexes
CREATE INDEX idx_content_bookmarks_user_id ON content_bookmarks(user_id);
CREATE INDEX idx_content_bookmarks_content_id ON content_bookmarks(content_id);

-- User follows indexes
CREATE INDEX idx_user_follows_follower ON user_follows(follower_id);
CREATE INDEX idx_user_follows_following ON user_follows(following_id);

-- User badges indexes
CREATE INDEX idx_user_badges_user_id ON user_badges(user_id);
CREATE INDEX idx_user_badges_badge_type ON user_badges(badge_type);
CREATE INDEX idx_user_badges_awarded_at ON user_badges(awarded_at);
CREATE INDEX idx_user_badges_is_active ON user_badges(is_active) WHERE is_active = true;

-- Audit log indexes
CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_resource_type ON audit_log(resource_type);
CREATE INDEX idx_audit_log_resource_id ON audit_log(resource_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);

-- Create triggers for automatic updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_content_updated_at BEFORE UPDATE ON content
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_badges_updated_at BEFORE UPDATE ON user_badges
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create GDPR compliance functions

-- Function to export all user data (GDPR Article 15 - Right of Access)
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
        'follows', json_build_object(
          'following', COALESCE(following_array.following, '[]'::json),
          'followers', COALESCE(followers_array.followers, '[]'::json)
        ),
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
        SELECT follower_id as user_id, json_agg(to_json(uf.*)) as following
        FROM user_follows uf
        WHERE uf.follower_id = user_uuid
        GROUP BY follower_id
    ) following_array ON u.id = following_array.user_id
    LEFT JOIN (
        SELECT following_id as user_id, json_agg(to_json(uf.*)) as followers
        FROM user_follows uf
        WHERE uf.following_id = user_uuid
        GROUP BY following_id
    ) followers_array ON u.id = followers_array.user_id
    WHERE u.id = user_uuid;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to delete all user data (GDPR Article 17 - Right to Erasure)
CREATE OR REPLACE FUNCTION delete_user_data(user_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
    user_deleted BOOLEAN := FALSE;
BEGIN
    -- Delete in correct order due to foreign key constraints
    -- Cascading deletes will handle user_badges, content_urls, and content
    DELETE FROM content_bookmarks WHERE user_id = user_uuid;
    DELETE FROM user_follows WHERE follower_id = user_uuid OR following_id = user_uuid;

    DELETE FROM content WHERE user_id = user_uuid;
    DELETE FROM users WHERE id = user_uuid RETURNING TRUE INTO user_deleted;

    -- Anonymize audit log entries (retain for compliance/security)
    UPDATE audit_log SET user_id = NULL WHERE user_id = user_uuid;

    RETURN user_deleted;
END;
$$ LANGUAGE plpgsql;

-- Add table comments for documentation
COMMENT ON TABLE users IS 'User accounts linked to AWS Cognito identities';
COMMENT ON TABLE content IS 'User-generated content (blogs, videos, talks, etc.)';
COMMENT ON TABLE content_urls IS 'URLs associated with content items';
COMMENT ON TABLE user_badges IS 'AWS program badges awarded to users';
COMMENT ON TABLE audit_log IS 'System audit trail for compliance and debugging';

COMMENT ON FUNCTION export_user_data(UUID) IS 'GDPR compliant user data export - Article 15 Right of Access';
COMMENT ON FUNCTION delete_user_data(UUID) IS 'GDPR compliant user data deletion - Article 17 Right to Erasure';
