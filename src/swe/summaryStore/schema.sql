-- Cloud SQL Schema for File/Folder Summary Storage
-- This schema supports sharing summaries across team members via Cloud SQL (PostgreSQL)

-- Main table for storing file and folder summaries
CREATE TABLE IF NOT EXISTS file_summaries (
    id SERIAL PRIMARY KEY,

    -- Repository identifier (e.g., "gitlab.com/team/repo-name")
    repository_id VARCHAR(255) NOT NULL,

    -- Relative path to the file/folder from repository root
    file_path VARCHAR(1024) NOT NULL,

    -- MD5 hash of the file content (for cache invalidation)
    content_hash VARCHAR(64) NOT NULL,

    -- Short summary (max ~15 words)
    short_summary TEXT NOT NULL,

    -- Long summary (2-4 sentences)
    long_summary TEXT NOT NULL,

    -- Type of summary: 'file', 'folder', or 'project'
    summary_type VARCHAR(20) NOT NULL CHECK (summary_type IN ('file', 'folder', 'project')),

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Ensure unique path per repository
    UNIQUE(repository_id, file_path)
);

-- Index for fast repository lookups
CREATE INDEX IF NOT EXISTS idx_summaries_repo
ON file_summaries(repository_id);

-- Index for filtering by summary type
CREATE INDEX IF NOT EXISTS idx_summaries_repo_type
ON file_summaries(repository_id, summary_type);

-- Index for path-based lookups (useful for folder navigation)
CREATE INDEX IF NOT EXISTS idx_summaries_repo_path
ON file_summaries(repository_id, file_path);

-- Function to update the updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at on row changes
DROP TRIGGER IF EXISTS update_file_summaries_updated_at ON file_summaries;
CREATE TRIGGER update_file_summaries_updated_at
    BEFORE UPDATE ON file_summaries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE file_summaries IS 'Stores LLM-generated summaries for files and folders in repositories';
COMMENT ON COLUMN file_summaries.repository_id IS 'Unique identifier for the repository (e.g., gitlab.com/team/repo)';
COMMENT ON COLUMN file_summaries.file_path IS 'Relative path from repository root';
COMMENT ON COLUMN file_summaries.content_hash IS 'MD5 hash of content for cache invalidation';
COMMENT ON COLUMN file_summaries.short_summary IS 'Brief summary (~15 words)';
COMMENT ON COLUMN file_summaries.long_summary IS 'Detailed summary (2-4 sentences)';
COMMENT ON COLUMN file_summaries.summary_type IS 'Type: file, folder, or project';
