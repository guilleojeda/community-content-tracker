-- Rollback migration 010_duplicate_pairs.sql

-- Drop duplicate_pairs table
DROP TABLE IF EXISTS duplicate_pairs CASCADE;

-- Drop enums
DROP TYPE IF EXISTS duplicate_resolution_enum;
DROP TYPE IF EXISTS duplicate_similarity_type_enum;
