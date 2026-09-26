import os
from pathlib import Path
from unittest.mock import MagicMock
from uuid import uuid4

import psycopg
import pytest

from app.database import Repository
from app.models import Analysis, ReportInput, Tag


@pytest.mark.parametrize("confidence,status", [(0.599, "needs_review"), (0.60, "processed")])
def test_review_status_is_calculated_before_rounding(confidence, status):
    repo = Repository.__new__(Repository)
    repo.pool = MagicMock()
    repo.save(
        ReportInput(audio_transcription="Pothole", video_transcription="", latitude=45, longitude=-73),
        "Pothole", Analysis(issue="Pothole", severity_score=5, ai_confidence=confidence, cost_roi_value="Medium", tag="roads"),
    )
    args = repo.pool.connection.return_value.__enter__.return_value.execute.call_args.args
    assert args[1][-1] == status
    assert str(args[1][7]) == "0.60"


def test_query_filters_use_sql_parameters():
    repo = Repository.__new__(Repository)
    repo.pool = MagicMock()
    connection = repo.pool.connection.return_value.__enter__.return_value
    connection.execute.return_value.fetchall.return_value = []
    assert repo.list(Tag.roads, 5) == []
    sql, parameters = connection.execute.call_args.args
    assert "tag = %s" in sql and "severity_score >= %s" in sql
    assert parameters == ["roads", 5]


@pytest.fixture
def integration_repo():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set TEST_DATABASE_URL to run disposable PostgreSQL integration checks")
    schema = "test_municipal_" + uuid4().hex
    with psycopg.connect(url, autocommit=True) as connection:
        connection.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
        connection.execute(f'CREATE SCHEMA "{schema}"')
    # Isolate test tables in a fresh schema; never alter existing reports.
    conninfo = psycopg.conninfo.make_conninfo(url, options=f"-c search_path={schema},public")
    repo = Repository(conninfo)
    try:
        with psycopg.connect(conninfo) as connection:
            connection.execute(Path("schema.sql").read_text())
        repo.open()
        yield repo
    finally:
        repo.close()
        with psycopg.connect(url, autocommit=True) as connection:
            connection.execute(f'DROP SCHEMA "{schema}" CASCADE')


def test_postgres_persistence_and_filtering(integration_repo):
    repo = integration_repo
    for confidence, tag in [(0.599, "roads"), (0.60, "lights")]:
        repo.save(ReportInput(audio_transcription="Evidence", video_transcription="", latitude=45, longitude=-73),
                  "Summary", Analysis(issue="Issue", severity_score=5, ai_confidence=confidence, cost_roi_value="Low", tag=tag))
    rows = repo.list(None, None)
    assert len(rows) == 2
    assert rows[0].tag == "lights"
    assert rows[0].status == "processed"
    assert rows[1].status == "needs_review"
    assert rows[1].ai_confidence == 0.60
    assert len(repo.list(Tag.roads, 5)) == 1
    assert repo.list(None, 6) == []


def photo_report():
    import base64
    from io import BytesIO
    from PIL import Image
    image = BytesIO()
    Image.new("RGB", (40, 30), "gray").save(image, "JPEG")
    return ReportInput(audio_transcription="Pothole", video_transcription="Road damage", latitude=45., longitude=-73.,
                       photo_base64=base64.b64encode(image.getvalue()).decode())


def photo_analysis():
    return Analysis(issue="Pothole", severity_score=5, ai_confidence=.8, cost_roi_value="Low", tag="roads")


def test_postgres_photo_lifecycle_and_lease_fencing(integration_repo):
    repo = integration_repo
    report = photo_report()
    report_id = repo.save(report, "Summary", photo_analysis(), bucket_name="private-bucket")
    assert repo.list(None, None)[0].photo_status == "pending"
    first = repo.claim_photo_job()
    assert first["report_id"] == report_id and first["attempts"] == 1
    assert bytes(first["source_bytes"]) == report.photo_bytes
    assert repo.claim_photo_job() is None
    with repo.pool.connection() as connection:
        connection.execute("UPDATE report_photo_jobs SET lease_until = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE report_id = %s", (report_id,))
    second = repo.claim_photo_job()
    assert second["attempts"] == 2 and second["lease_token"] != first["lease_token"]
    assert not repo.prepare_photo_job(report_id, first["lease_token"], b"stale", "stale")
    assert not repo.complete_photo_job(report_id, first["lease_token"], "gs://wrong")
    assert repo.prepare_photo_job(report_id, second["lease_token"], b"compressed", "digest")
    assert repo.complete_photo_job(report_id, second["lease_token"], f"gs://private-bucket/reports/{report_id}/photo.jpg")
    row = repo.list(None, None)[0]
    assert row.photo_status == "uploaded" and row.photo_object.startswith("gs://private-bucket/")
    with repo.pool.connection() as connection:
        job = connection.execute("SELECT * FROM report_photo_jobs WHERE report_id = %s", (report_id,)).fetchone()
        assert job["state"] == "done" and job["source_bytes"] is None and job["compressed_bytes"] is None


def test_postgres_retry_backoff_and_exhausted_lease_recovery(integration_repo):
    repo = integration_repo
    report_id = repo.save(photo_report(), "Summary", photo_analysis(), bucket_name="private-bucket")
    first = repo.claim_photo_job()
    assert repo.fail_photo_job(report_id, first["lease_token"], "ServiceUnavailable")
    assert repo.claim_photo_job() is None  # Backoff prevents immediate retry.
    with repo.pool.connection() as connection:
        row = connection.execute("SELECT state, attempts, source_bytes, next_attempt_at > CURRENT_TIMESTAMP AS delayed FROM report_photo_jobs WHERE report_id = %s", (report_id,)).fetchone()
        assert row["state"] == "queued" and row["delayed"] and row["source_bytes"] is not None
        connection.execute("UPDATE report_photo_jobs SET state = 'uploading', attempts = 5, lease_until = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE report_id = %s", (report_id,))
    assert repo.claim_photo_job() is None
    assert repo.list(None, None)[0].photo_status == "failed"
    assert repo.retry_photo_job(report_id)
    assert repo.list(None, None)[0].photo_status == "pending"
    assert repo.claim_photo_job()["attempts"] == 1


def test_postgres_job_failure_rolls_back_report(integration_repo):
    repo = integration_repo
    with repo.pool.connection() as connection:
        connection.execute("ALTER TABLE report_photo_jobs ADD CONSTRAINT test_reject_bucket CHECK (bucket_name != 'reject')")
    with pytest.raises(psycopg.errors.CheckViolation):
        repo.save(photo_report(), "Summary", photo_analysis(), bucket_name="reject")
    assert repo.list(None, None) == []


def test_postgres_migration_is_repeatable_and_preserves_existing_reports(integration_repo):
    repo = integration_repo
    report_id = repo.save(ReportInput(audio_transcription="Legacy evidence", video_transcription="", latitude=45., longitude=-73.),
                          "Summary", photo_analysis())
    with repo.pool.connection() as connection:
        # Recreate the old shape in this disposable schema to exercise the upgrade.
        connection.execute("DROP TABLE report_photo_jobs")
        connection.execute("ALTER TABLE municipal_reports DROP COLUMN photo_status, DROP COLUMN photo_object")
        connection.execute(Path("migrations/001_report_photos.sql").read_text())
        connection.execute(Path("migrations/001_report_photos.sql").read_text())
    row = repo.list(None, None)[0]
    assert row.id == report_id and row.photo_status == "none" and row.photo_object is None


def test_postgres_concurrent_workers_only_claim_a_job_once(integration_repo):
    from concurrent.futures import ThreadPoolExecutor
    repo = integration_repo
    report_id = repo.save(photo_report(), "Summary", photo_analysis(), bucket_name="private-bucket")
    with ThreadPoolExecutor(max_workers=4) as threads:
        claims = list(threads.map(lambda _: repo.claim_photo_job(), range(4)))
    claimed = [row for row in claims if row is not None]
    assert len(claimed) == 1 and claimed[0]["report_id"] == report_id


def test_postgres_worker_recovers_uploaded_photo_after_acknowledgment_crash(integration_repo, monkeypatch):
    import base64
    import hashlib
    from unittest.mock import Mock
    from google.api_core.exceptions import PreconditionFailed
    from app.photo_worker import PhotoWorker
    repo = integration_repo
    report_id = repo.save(photo_report(), "Summary", photo_analysis(), bucket_name="private-bucket")
    client = Mock(); blob = client.bucket.return_value.blob.return_value
    stored = {}
    def upload(data, **kwargs):
        if stored:
            raise PreconditionFailed("already uploaded")
        stored.update(data=data, metadata=dict(blob.metadata))
    def reload(**kwargs):
        blob.metadata = stored["metadata"]
        blob.size = len(stored["data"])
        blob.md5_hash = base64.b64encode(hashlib.md5(stored["data"], usedforsecurity=False).digest()).decode()
    blob.upload_from_string.side_effect, blob.reload.side_effect = upload, reload
    worker = PhotoWorker(repo, client)
    complete = repo.complete_photo_job
    monkeypatch.setattr(repo, "complete_photo_job", Mock(side_effect=psycopg.OperationalError("acknowledgment lost")))
    with pytest.raises(psycopg.OperationalError):
        worker.process_one()
    assert repo.list(None, None)[0].photo_status == "pending"
    with repo.pool.connection() as connection:
        row = connection.execute("SELECT * FROM report_photo_jobs WHERE report_id = %s", (report_id,)).fetchone()
        assert row["source_bytes"] is not None and bytes(row["compressed_bytes"]) == stored["data"]
        connection.execute("UPDATE report_photo_jobs SET lease_until = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE report_id = %s", (report_id,))
    monkeypatch.setattr(repo, "complete_photo_job", complete)
    assert worker.process_one()
    assert repo.list(None, None)[0].photo_status == "uploaded"
    assert blob.upload_from_string.call_count == 2
