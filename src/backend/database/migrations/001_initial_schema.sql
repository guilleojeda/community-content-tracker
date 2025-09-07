-- Initial database schema for AWS Community Content Hub
-- This schema matches the TypeScript types exactly

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Create custom types (enums)
CREATE TYPE visibility AS ENUM (
  'private',
  'aws_only', 
  'aws_community',
  'public'
);

CREATE TYPE content_type AS ENUM (
  'blog',
  'youtube',
  'github',
  'conference_talk',
  'podcast'
);

CREATE TYPE badge_type AS ENUM (
  'community_builder',
  'hero',
  'ambassador',
  'user_group_leader'
);

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cognito_sub VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(100) UNIQUE NOT NULL,
  profile_slug VARCHAR(100) UNIQUE NOT NULL,
  default_visibility visibility NOT NULL DEFAULT 'private',
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  is_aws_employee BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT users_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  CONSTRAINT users_username_format CHECK (username ~* '^[a-zA-Z0-9_-]{3,30}$'),
  CONSTRAINT users_profile_slug_format CHECK (profile_slug ~* '^[a-z0-9-]{3,50}$')
);

-- Content table
CREATE TABLE content (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  content_type content_type NOT NULL,
  visibility visibility NOT NULL DEFAULT 'private',
  publish_date TIMESTAMP WITH TIME ZONE,
  capture_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  metrics JSONB NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  embedding vector(1536), -- OpenAI embedding dimension
  is_claimed BOOLEAN NOT NULL DEFAULT TRUE,
  original_author VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT content_title_not_empty CHECK (LENGTH(TRIM(title)) > 0),
  CONSTRAINT content_publish_date_reasonable CHECK (publish_date IS NULL OR publish_date <= NOW()),
  CONSTRAINT content_tags_format CHECK (array_length(tags, 1) IS NULL OR array_length(tags, 1) <= 20)
);

-- Content URLs table (separate for normalization)
CREATE TABLE content_urls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT content_urls_url_format CHECK (url ~* '^https?://.*'),
  CONSTRAINT content_urls_url_length CHECK (LENGTH(url) <= 2048)
);

-- User badges table
CREATE TABLE user_badges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_type badge_type NOT NULL,
  awarded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  awarded_by UUID REFERENCES users(id),
  metadata JSONB DEFAULT '{}',
  
  -- Prevent duplicate badges of same type for same user
  UNIQUE(user_id, badge_type)
);

-- Create indexes for performance
-- Users indexes
CREATE INDEX idx_users_cognito_sub ON users(cognito_sub);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_profile_slug ON users(profile_slug);
CREATE INDEX idx_users_is_aws_employee ON users(is_aws_employee);
CREATE INDEX idx_users_created_at ON users(created_at DESC);

-- Content indexes
CREATE INDEX idx_content_user_id ON content(user_id);
CREATE INDEX idx_content_content_type ON content(content_type);
CREATE INDEX idx_content_visibility ON content(visibility);
CREATE INDEX idx_content_publish_date ON content(publish_date DESC);
CREATE INDEX idx_content_capture_date ON content(capture_date DESC);
CREATE INDEX idx_content_created_at ON content(created_at DESC);
CREATE INDEX idx_content_is_claimed ON content(is_claimed);

-- Vector similarity search index using HNSW (Hierarchical Navigable Small World)
-- This is optimized for high-dimensional vector similarity searches
CREATE INDEX idx_content_embedding_cosine ON content 
USING hnsw (embedding vector_cosine_ops) 
WITH (m = 16, ef_construction = 64);

-- Additional vector index for L2 distance (Euclidean)
CREATE INDEX idx_content_embedding_l2 ON content 
USING hnsw (embedding vector_l2_ops) 
WITH (m = 16, ef_construction = 64);

-- GIN index for array operations on tags
CREATE INDEX idx_content_tags ON content USING GIN(tags);

-- JSONB indexes for metrics
CREATE INDEX idx_content_metrics ON content USING GIN(metrics);

-- Content URLs indexes
CREATE INDEX idx_content_urls_content_id ON content_urls(content_id);
CREATE INDEX idx_content_urls_url ON content_urls(url);

-- User badges indexes
CREATE INDEX idx_user_badges_user_id ON user_badges(user_id);
CREATE INDEX idx_user_badges_badge_type ON user_badges(badge_type);
CREATE INDEX idx_user_badges_awarded_at ON user_badges(awarded_at DESC);

-- Composite indexes for common queries
CREATE INDEX idx_content_user_visibility ON content(user_id, visibility);
CREATE INDEX idx_content_type_visibility ON content(content_type, visibility);
CREATE INDEX idx_content_visibility_publish_date ON content(visibility, publish_date DESC);

-- Full-text search indexes
CREATE INDEX idx_content_title_fts ON content USING GIN(to_tsvector('english', title));
CREATE INDEX idx_content_description_fts ON content USING GIN(to_tsvector('english', description));

-- Update triggers for updated_at columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at 
  BEFORE UPDATE ON users 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_content_updated_at 
  BEFORE UPDATE ON content 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Function to search content by vector similarity
CREATE OR REPLACE FUNCTION search_content_by_embedding(
  query_embedding vector(1536),
  similarity_threshold float DEFAULT 0.8,
  max_results integer DEFAULT 10,
  content_types content_type[] DEFAULT NULL,
  visibility_filter visibility[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  title VARCHAR(500),
  description TEXT,
  content_type content_type,
  visibility visibility,
  similarity float,
  user_id UUID,
  tags TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.title,
    c.description,
    c.content_type,
    c.visibility,
    1 - (c.embedding <=> query_embedding) as similarity,
    c.user_id,
    c.tags
  FROM content c
  WHERE 
    c.embedding IS NOT NULL
    AND (1 - (c.embedding <=> query_embedding)) >= similarity_threshold
    AND (content_types IS NULL OR c.content_type = ANY(content_types))
    AND (visibility_filter IS NULL OR c.visibility = ANY(visibility_filter))
  ORDER BY c.embedding <=> query_embedding
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- Function to get user statistics
CREATE OR REPLACE FUNCTION get_user_stats(user_uuid UUID)
RETURNS JSON AS $$
DECLARE
  stats JSON;
BEGIN
  SELECT json_build_object(
    'total_content', COUNT(*),
    'content_by_type', json_object_agg(content_type, type_count),
    'content_by_visibility', json_object_agg(visibility, visibility_count),
    'badges', COALESCE(badges.badge_list, '[]'::json)
  ) INTO stats
  FROM (
    SELECT 
      content_type,
      COUNT(*) as type_count,
      visibility,
      COUNT(*) as visibility_count
    FROM content 
    WHERE user_id = user_uuid
    GROUP BY GROUPING SETS ((content_type), (visibility))
  ) content_stats
  LEFT JOIN (
    SELECT json_agg(json_build_object(
      'badge_type', badge_type,
      'awarded_at', awarded_at
    )) as badge_list
    FROM user_badges 
    WHERE user_id = user_uuid
  ) badges ON true;
  
  RETURN stats;
END;
$$ LANGUAGE plpgsql;

-- Views for common queries
CREATE VIEW public_content AS
SELECT 
  c.id,
  c.title,
  c.description,
  c.content_type,
  c.publish_date,
  c.capture_date,
  c.tags,
  c.user_id,
  u.username,
  u.profile_slug,
  array_agg(cu.url) as urls
FROM content c
JOIN users u ON c.user_id = u.id
LEFT JOIN content_urls cu ON c.id = cu.content_id
WHERE c.visibility = 'public'
GROUP BY c.id, u.username, u.profile_slug
ORDER BY c.publish_date DESC NULLS LAST;

-- Performance monitoring view
CREATE VIEW database_stats AS
SELECT 
  schemaname,
  tablename,
  attname,
  n_distinct,
  correlation,
  most_common_vals,
  most_common_freqs
FROM pg_stats 
WHERE schemaname = 'public'
ORDER BY schemaname, tablename, attname;

-- Grant permissions (adjust as needed for your application)
-- These would typically be set up for specific database users/roles
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user;

-- Insert initial data (optional, for development)
-- This would typically be done via seed scripts

COMMENT ON TABLE users IS 'User accounts and profile information';
COMMENT ON TABLE content IS 'Community content items with vector embeddings for similarity search';
COMMENT ON TABLE content_urls IS 'URLs associated with content items';
COMMENT ON TABLE user_badges IS 'Badges and achievements awarded to users';

COMMENT ON COLUMN content.embedding IS 'Vector embedding for content similarity search (OpenAI ada-002 format)';
COMMENT ON COLUMN content.metrics IS 'Flexible metrics storage (views, likes, shares, etc.)';
COMMENT ON COLUMN content.tags IS 'Array of tags for content categorization';

-- Analyze tables for query optimization
ANALYZE users;
ANALYZE content;
ANALYZE content_urls;
ANALYZE user_badges;