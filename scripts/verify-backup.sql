-- verify-backup.sql
-- Usage: psql -f scripts/verify-backup.sql "$DATABASE_URL"
-- Validates restored Community Content Hub backups for GDPR-critical tables.

\echo 'Verifying required extensions...'
SELECT extname, extversion
FROM pg_extension
WHERE extname IN ('vector', 'pg_trgm')
ORDER BY extname;

\echo 'Checking user and content counts...'
SELECT
  (SELECT COUNT(*) FROM users) AS user_count,
  (SELECT COUNT(*) FROM content) AS content_count,
  (SELECT COUNT(*) FROM user_badges) AS user_badge_count,
  (SELECT COUNT(*) FROM channels) AS channel_count;

\echo 'Checking GDPR-related tables...'
SELECT
  (SELECT COUNT(*) FROM user_consent) AS user_consent_count,
  (SELECT COUNT(*) FROM audit_log) AS audit_log_count,
  (SELECT COUNT(*) FROM analytics_events WHERE event_type = 'export') AS export_event_count;

\echo 'Sampling recent audit log entries...'
TABLE (
  SELECT id, action, resource_type, resource_id, created_at
  FROM audit_log
  ORDER BY created_at DESC
  LIMIT 5
);

\echo 'Sampling recent saved exports...'
TABLE (
  SELECT id,
         metadata->>'exportType' AS export_type,
         metadata->>'exportFormat' AS export_format,
         metadata->>'rowCount' AS row_count,
         created_at
  FROM analytics_events
  WHERE event_type = 'export'
  ORDER BY created_at DESC
  LIMIT 5
);

\echo 'Verifying pgvector column integrity...'
SELECT
  COUNT(*) FILTER (WHERE embedding IS NULL) AS null_embeddings,
  COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS populated_embeddings
FROM content;

\echo 'Backup verification complete.'
