-- 010_duplicate_pairs.sql
-- Migration: Add duplicate detection persistence
-- Sprint: 7
-- Task: 7.6
-- Date: 2024-10-17

-- Create duplicate_resolution enum
CREATE TYPE duplicate_resolution_enum AS ENUM (
  'pending',
  'merged',
  'kept_both',
  'deleted_one',
  'false_positive'
);

-- Create duplicate_similarity_type enum
CREATE TYPE duplicate_similarity_type_enum AS ENUM (
  'title',
  'url',
  'embedding',
  'combined'
);

-- Create duplicate_pairs table for persistence
CREATE TABLE IF NOT EXISTS duplicate_pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id_1 UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  content_id_2 UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  similarity_type duplicate_similarity_type_enum NOT NULL,
  similarity_score DECIMAL(5,4) NOT NULL,
  resolution duplicate_resolution_enum DEFAULT 'pending' NOT NULL,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_notes TEXT,
  detected_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(content_id_1, content_id_2),
  CHECK (content_id_1 < content_id_2)
);

-- Create indexes for duplicate queries
CREATE INDEX IF NOT EXISTS idx_duplicate_pairs_content_1 ON duplicate_pairs(content_id_1);
CREATE INDEX IF NOT EXISTS idx_duplicate_pairs_content_2 ON duplicate_pairs(content_id_2);
CREATE INDEX IF NOT EXISTS idx_duplicate_pairs_resolution ON duplicate_pairs(resolution);
CREATE INDEX IF NOT EXISTS idx_duplicate_pairs_pending ON duplicate_pairs(resolution) WHERE resolution = 'pending';
CREATE INDEX IF NOT EXISTS idx_duplicate_pairs_detected_at ON duplicate_pairs(detected_at DESC);

-- Add table comments
COMMENT ON TABLE duplicate_pairs IS 'Detected duplicate content pairs with resolution tracking';
COMMENT ON COLUMN duplicate_pairs.similarity_type IS 'How duplicates were detected: title, url, embedding, or combined';
COMMENT ON COLUMN duplicate_pairs.similarity_score IS 'Similarity score (0.0-1.0)';
COMMENT ON COLUMN duplicate_pairs.resolution IS 'How the duplicate was handled: pending, merged, kept_both, deleted_one, false_positive';
COMMENT ON COLUMN duplicate_pairs.resolved_at IS 'When the duplicate was resolved';
COMMENT ON COLUMN duplicate_pairs.resolved_by IS 'User ID who resolved the duplicate';
