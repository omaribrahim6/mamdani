-- Run explicitly before starting the updated API and photo worker.
BEGIN;
ALTER TABLE municipal_reports
    ADD COLUMN IF NOT EXISTS photo_status VARCHAR(20) NOT NULL DEFAULT 'none'
        CHECK (photo_status IN ('none', 'pending', 'uploaded', 'failed')),
    ADD COLUMN IF NOT EXISTS photo_object TEXT;

CREATE TABLE IF NOT EXISTS report_photo_jobs (
    report_id UUID PRIMARY KEY REFERENCES municipal_reports(id) ON DELETE CASCADE,
    bucket_name TEXT NOT NULL,
    object_name TEXT NOT NULL,
    source_bytes BYTEA,
    compressed_bytes BYTEA,
    compressed_sha256 VARCHAR(64),
    state VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (state IN ('queued', 'uploading', 'done', 'failed')),
    attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_token UUID,
    lease_until TIMESTAMPTZ,
    last_error VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_photo_jobs_ready
    ON report_photo_jobs(next_attempt_at) WHERE state IN ('queued', 'uploading');
COMMIT;
