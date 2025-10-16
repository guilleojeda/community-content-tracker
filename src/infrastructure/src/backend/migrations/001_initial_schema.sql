-- 001_initial_schema.sql
-- Migration: Create initial database schema for AWS Community Content Hub
-- Sprint: 1-2
-- Date: 2024-01-01

-- Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create enums that match TypeScript types exactly
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

-- Content URLs table
CREATE TABLE content_urls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID REFERENCES content(id) ON DELETE CASCADE NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(content_id, url)
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

-- Audit log table
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

-- Create indexes
CREATE INDEX idx_users_cognito_sub ON users(cognito_sub);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_profile_slug ON users(profile_slug);
CREATE INDEX idx_users_is_admin ON users(is_admin) WHERE is_admin = true;
CREATE INDEX idx_users_is_aws_employee ON users(is_aws_employee) WHERE is_aws_employee = true;
CREATE INDEX idx_users_created_at ON users(created_at);

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
CREATE INDEX idx_content_embedding ON content USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_content_user_visibility ON content(user_id, visibility);
CREATE INDEX idx_content_type_visibility ON content(content_type, visibility);
CREATE INDEX idx_content_publish_visibility ON content(publish_date, visibility) WHERE publish_date IS NOT NULL;

CREATE INDEX idx_content_urls_content_id ON content_urls(content_id);
CREATE INDEX idx_content_urls_url ON content_urls(url);

CREATE INDEX idx_user_badges_user_id ON user_badges(user_id);
CREATE INDEX idx_user_badges_badge_type ON user_badges(badge_type);
CREATE INDEX idx_user_badges_awarded_at ON user_badges(awarded_at);
CREATE INDEX idx_user_badges_is_active ON user_badges(is_active) WHERE is_active = true;

CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_resource_type ON audit_log(resource_type);
CREATE INDEX idx_audit_log_resource_id ON audit_log(resource_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);

-- Create triggers
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

-- GDPR compliance functions
CREATE OR REPLACE FUNCTION export_user_data(user_uuid UUID)
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'user', to_json(u.*),
        'content', COALESCE(content_array.content, '[]'::json),
        'badges', COALESCE(badges_array.badges, '[]'::json),
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
    WHERE u.id = user_uuid;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION delete_user_data(user_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    DELETE FROM users WHERE id = user_uuid;
    UPDATE audit_log SET user_id = NULL WHERE user_id = user_uuid;
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE users IS 'User accounts linked to AWS Cognito identities';
COMMENT ON TABLE content IS 'User-generated content (blogs, videos, talks, etc.)';
COMMENT ON TABLE content_urls IS 'URLs associated with content items';
COMMENT ON TABLE user_badges IS 'AWS program badges awarded to users';
COMMENT ON TABLE audit_log IS 'System audit trail for compliance and debugging';
COMMENT ON FUNCTION export_user_data(UUID) IS 'GDPR compliant user data export';
COMMENT ON FUNCTION delete_user_data(UUID) IS 'GDPR compliant user data deletion';
