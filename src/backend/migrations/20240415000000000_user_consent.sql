-- 009_user_consent.sql
-- Migration: Add GDPR consent management
-- Sprint: 7
-- Task: 7.3
-- Date: 2024-10-17

-- Create consent_type enum
CREATE TYPE consent_type_enum AS ENUM (
  'analytics',
  'functional',
  'marketing'
);

-- Create user_consent table for GDPR compliance
CREATE TABLE IF NOT EXISTS user_consent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type consent_type_enum NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT false,
  granted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  consent_version VARCHAR(50) DEFAULT '1.0' NOT NULL,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, consent_type)
);

-- Create indexes for consent queries
CREATE INDEX IF NOT EXISTS idx_user_consent_user_id ON user_consent(user_id);
CREATE INDEX IF NOT EXISTS idx_user_consent_type ON user_consent(consent_type);
CREATE INDEX IF NOT EXISTS idx_user_consent_granted ON user_consent(granted) WHERE granted = true;

-- Add table comments
COMMENT ON TABLE user_consent IS 'GDPR consent tracking for lawful data processing';
COMMENT ON COLUMN user_consent.consent_type IS 'Type of consent: analytics, functional, marketing';
COMMENT ON COLUMN user_consent.granted IS 'Current consent status (true = granted, false = revoked)';
COMMENT ON COLUMN user_consent.granted_at IS 'Timestamp when consent was granted';
COMMENT ON COLUMN user_consent.revoked_at IS 'Timestamp when consent was revoked';
COMMENT ON COLUMN user_consent.consent_version IS 'Version of consent policy agreed to';
