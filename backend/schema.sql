CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS municipal_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    raw_audio_text TEXT,
    raw_video_text TEXT,
    latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    street_address TEXT,
    standardized_situation TEXT NOT NULL,
    issue_title VARCHAR(255) NOT NULL,
    severity_score INT NOT NULL CHECK (severity_score BETWEEN 1 AND 10),
    ai_confidence NUMERIC(3,2) NOT NULL CHECK (ai_confidence BETWEEN 0.0 AND 1.0),
    cost_roi_value VARCHAR(50) NOT NULL CHECK (cost_roi_value IN ('Low', 'Medium', 'High')),
    tag VARCHAR(50) NOT NULL CHECK (tag IN ('roads', 'lights', 'sanitation', 'utilities')),
    status VARCHAR(20) NOT NULL DEFAULT 'processed' CHECK (status IN ('processed', 'needs_review'))
);

CREATE INDEX IF NOT EXISTS idx_reports_location ON municipal_reports (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_reports_tag ON municipal_reports (tag);

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
