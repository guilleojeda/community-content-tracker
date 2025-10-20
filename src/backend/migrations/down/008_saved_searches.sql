-- Down migration for 008_saved_searches.sql
-- Removes saved searches functionality

-- Drop saved_searches table
DROP TABLE IF EXISTS saved_searches CASCADE;
