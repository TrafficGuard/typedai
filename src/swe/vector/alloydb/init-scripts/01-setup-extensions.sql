-- AlloyDB Omni initialization script
-- This script runs automatically on first database creation

\echo 'Setting up AlloyDB extensions...'

-- Install vector extension
CREATE EXTENSION IF NOT EXISTS vector CASCADE;
\echo 'Vector extension installed'

-- Install AlloyDB ScaNN extension
CREATE EXTENSION IF NOT EXISTS alloydb_scann CASCADE;
\echo 'AlloyDB ScaNN extension installed'

-- Try to install google_columnar_engine (may not be available in all versions)
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS google_columnar_engine CASCADE;
    RAISE NOTICE 'Google Columnar Engine extension installed';
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Google Columnar Engine extension not available (this is OK for development)';
END;
$$;

-- Grant necessary permissions
GRANT ALL PRIVILEGES ON DATABASE vector_db TO postgres;

-- Create AI schema if it doesn't exist (for automated embeddings)
CREATE SCHEMA IF NOT EXISTS ai;

-- Verify installations
\echo 'Installed extensions:'
SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'alloydb_scann', 'google_columnar_engine');

\echo 'AlloyDB setup complete!'
