from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID, uuid4

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .models import Analysis, ReportInput, ReportResponse, ReportStatus, Tag


class Repository:
    def __init__(self, connection_url: str):
        self.pool = ConnectionPool(
            connection_url, open=False, min_size=1, max_size=10, timeout=10,
            kwargs={"row_factory": dict_row, "connect_timeout": 10},
        )

    def open(self):
        self.pool.open(wait=True, timeout=15)

    def close(self):
        self.pool.close()

    def save(self, report: ReportInput, summary: str, analysis: Analysis, *, bucket_name: str | None = None) -> UUID:
        if report.photo_bytes is not None and not bucket_name:
            raise ValueError("Photo bucket required")
        status = ReportStatus.needs_review if analysis.ai_confidence < 0.60 else ReportStatus.processed
        confidence = Decimal(str(analysis.ai_confidence)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        with self.pool.connection() as connection:
            row = connection.execute(
                """INSERT INTO municipal_reports
                (raw_audio_text, raw_video_text, latitude, longitude,
                 standardized_situation, issue_title, severity_score,
                 ai_confidence, cost_roi_value, tag, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                (report.audio_transcription, report.video_transcription, report.latitude,
                 report.longitude, summary, analysis.issue, analysis.severity_score,
                 confidence, analysis.cost_roi_value.value, analysis.tag.value, status.value),
            ).fetchone()
            report_id = row["id"]
            if report.photo_bytes is not None:
                connection.execute("UPDATE municipal_reports SET photo_status = 'pending' WHERE id = %s", (report_id,))
                connection.execute(
                    """INSERT INTO report_photo_jobs (report_id, bucket_name, object_name, source_bytes)
                    VALUES (%s, %s, %s, %s)""",
                    (report_id, bucket_name, f"reports/{report_id}/photo.jpg", report.photo_bytes),
                )
        # The report and durable job commit together before acknowledging success.
        return report_id

    def list(self, tag: Tag | None, min_severity: int | None) -> list[ReportResponse]:
        conditions, params = [], []
        if tag is not None:
            conditions.append("tag = %s")
            params.append(tag.value)
        if min_severity is not None:
            conditions.append("severity_score >= %s")
            params.append(min_severity)
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        with self.pool.connection() as connection:
            rows = connection.execute(
                "SELECT * FROM municipal_reports" + where + " ORDER BY created_at DESC, id DESC", params,
            ).fetchall()
        return [ReportResponse(
            **{key: row[key] for key in (
                "id", "created_at", "raw_audio_text", "raw_video_text", "standardized_situation",
                "severity_score", "ai_confidence", "cost_roi_value", "tag", "status",
            )},
            photo_status=row["photo_status"], photo_object=row["photo_object"],
            issue=row["issue_title"],
            location={"latitude": row["latitude"], "longitude": row["longitude"],
                      "street_address": row["street_address"]},
        ) for row in rows]

    def claim_photo_job(self) -> dict | None:
        token = uuid4()
        with self.pool.connection() as connection:
            # A crash during the last attempt must not leave a job stuck forever.
            connection.execute("""WITH exhausted AS (
                UPDATE report_photo_jobs SET state = 'failed', lease_token = NULL, lease_until = NULL,
                    last_error = 'Worker lease expired after final attempt', updated_at = CURRENT_TIMESTAMP
                WHERE state = 'uploading' AND lease_until <= CURRENT_TIMESTAMP AND attempts >= 5
                RETURNING report_id)
                UPDATE municipal_reports SET photo_status = 'failed'
                WHERE id IN (SELECT report_id FROM exhausted)""")
            return connection.execute("""WITH candidate AS (
                SELECT report_id FROM report_photo_jobs
                WHERE attempts < 5 AND next_attempt_at <= CURRENT_TIMESTAMP
                  AND (state = 'queued' OR (state = 'uploading' AND lease_until <= CURRENT_TIMESTAMP))
                ORDER BY next_attempt_at, created_at
                FOR UPDATE SKIP LOCKED LIMIT 1)
                UPDATE report_photo_jobs j SET state = 'uploading', attempts = attempts + 1,
                    lease_token = %s, lease_until = CURRENT_TIMESTAMP + INTERVAL '120 seconds',
                    updated_at = CURRENT_TIMESTAMP
                FROM candidate c WHERE j.report_id = c.report_id RETURNING j.*""", (token,)).fetchone()

    def prepare_photo_job(self, report_id: UUID, token: UUID, data: bytes, digest: str) -> bool:
        with self.pool.connection() as connection:
            return connection.execute("""UPDATE report_photo_jobs SET compressed_bytes = %s,
                compressed_sha256 = %s, lease_until = CURRENT_TIMESTAMP + INTERVAL '120 seconds',
                updated_at = CURRENT_TIMESTAMP
                WHERE report_id = %s AND lease_token = %s AND state = 'uploading'
                RETURNING report_id""", (data, digest, report_id, token)).fetchone() is not None

    def complete_photo_job(self, report_id: UUID, token: UUID, object_uri: str) -> bool:
        with self.pool.connection() as connection:
            row = connection.execute("""UPDATE report_photo_jobs SET state = 'done',
                source_bytes = NULL, compressed_bytes = NULL, lease_token = NULL, lease_until = NULL,
                last_error = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE report_id = %s AND lease_token = %s AND state = 'uploading'
                RETURNING report_id""", (report_id, token)).fetchone()
            if row is None:
                return False
            connection.execute("""UPDATE municipal_reports SET photo_status = 'uploaded', photo_object = %s
                WHERE id = %s""", (object_uri, report_id))
        return True

    def fail_photo_job(self, report_id: UUID, token: UUID, error: str, permanent: bool = False) -> bool:
        with self.pool.connection() as connection:
            row = connection.execute("""UPDATE report_photo_jobs SET
                state = CASE WHEN attempts >= 5 OR %s THEN 'failed' ELSE 'queued' END,
                next_attempt_at = CURRENT_TIMESTAMP + (10 * power(2, attempts - 1)) * INTERVAL '1 second',
                lease_token = NULL, lease_until = NULL, last_error = %s, updated_at = CURRENT_TIMESTAMP
                WHERE report_id = %s AND lease_token = %s AND state = 'uploading'
                RETURNING state""", (permanent, error[:255], report_id, token)).fetchone()
            if row is None:
                return False
            if row["state"] == "failed":
                connection.execute("UPDATE municipal_reports SET photo_status = 'failed' WHERE id = %s", (report_id,))
        return True

    def retry_photo_job(self, report_id: UUID) -> bool:
        with self.pool.connection() as connection:
            row = connection.execute("""UPDATE report_photo_jobs SET state = 'queued', attempts = 0,
                next_attempt_at = CURRENT_TIMESTAMP, lease_token = NULL, lease_until = NULL,
                last_error = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE report_id = %s AND state = 'failed' AND source_bytes IS NOT NULL
                RETURNING report_id""", (report_id,)).fetchone()
            if row is None:
                return False
            connection.execute("UPDATE municipal_reports SET photo_status = 'pending' WHERE id = %s", (report_id,))
        return True
