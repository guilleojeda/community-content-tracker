-- Rollback migration 009_user_consent.sql

-- Drop user_consent table
DROP TABLE IF EXISTS user_consent CASCADE;

-- Drop consent_type enum
DROP TYPE IF EXISTS consent_type_enum;
