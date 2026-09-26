"""Run independently: python -m app.photo_worker (durable PostgreSQL job queue)."""
import argparse
import base64
import hashlib
import logging
import time
from uuid import UUID

import psycopg
from google.api_core import exceptions as cloud_errors
from google.api_core.retry import Retry
from google.cloud.storage.retry import ConditionalRetryPolicy, is_generation_specified
from psycopg_pool import PoolTimeout

from .config import get_settings
from .database import Repository
from .photos import compress_photo
from .startup import check_database, check_photo_storage, create_storage_client

logger = logging.getLogger(__name__)
# Bound client retries below the job's 120-second lease.
UPLOAD_RETRY = ConditionalRetryPolicy(Retry(timeout=55), is_generation_specified, ["query_params"])


class ObjectConflict(ValueError):
    pass


def upload_photo(client, job: dict, data: bytes, digest: str) -> str:
    blob = client.bucket(job["bucket_name"]).blob(job["object_name"])
    blob.metadata = {"report_id": str(job["report_id"]), "sha256": digest}
    try:
        blob.upload_from_string(data, content_type="image/jpeg", if_generation_match=0,
                                checksum="auto", timeout=30, retry=UPLOAD_RETRY)
    except cloud_errors.PreconditionFailed:
        logger.info("Existing photo object for report %s; verifying replay", job["report_id"])
        # Upload may have succeeded just before a worker crashed. The exact compressed
        # bytes were staged before upload, so replay remains stable across upgrades.
        blob.reload(timeout=30, retry=Retry(timeout=55))
        expected_md5 = base64.b64encode(hashlib.md5(data, usedforsecurity=False).digest()).decode()
        if ((blob.metadata or {}).get("report_id") != str(job["report_id"])
                or (blob.metadata or {}).get("sha256") != digest
                or blob.size != len(data) or blob.md5_hash != expected_md5):
            raise ObjectConflict("Object name already contains different photo data") from None
    return f"gs://{job['bucket_name']}/{job['object_name']}"


class PhotoWorker:
    def __init__(self, repository: Repository, client):
        self.repository, self.client = repository, client

    def process_one(self) -> bool:
        job = self.repository.claim_photo_job()
        if job is None:
            return False
        report_id, token = job["report_id"], job["lease_token"]
        started = time.monotonic()
        logger.info("Claimed photo report=%s attempt=%s", report_id, job.get("attempts"))
        try:
            data = job.get("compressed_bytes")
            if data is None:
                data = compress_photo(bytes(job["source_bytes"]))
                logger.info("Compressed photo report=%s source_bytes=%s jpeg_bytes=%s", report_id, len(job["source_bytes"]), len(data))
            else:
                data = bytes(data)
                logger.info("Reusing staged photo report=%s jpeg_bytes=%s", report_id, len(data))
            digest = hashlib.sha256(data).hexdigest()
            if not self.repository.prepare_photo_job(report_id, token, data, digest):
                logger.warning("Photo lease lost before upload report=%s", report_id)
                return True  # Another worker acquired the expired lease.
            logger.info("Uploading staged photo report=%s", report_id)
            uri = upload_photo(self.client, job, data, digest)
            if self.repository.complete_photo_job(report_id, token, uri):
                logger.info("Photo uploaded and acknowledged report=%s elapsed=%.2fs", report_id, time.monotonic() - started)
            else:
                logger.warning("Photo uploaded but acknowledgment lease lost report=%s", report_id)
        except (psycopg.Error, PoolTimeout):
            logger.warning("Photo database failure report=%s; lease retained for recovery", report_id)
            # Leave the lease intact: a DB outage may follow an already-successful upload.
            raise
        except Exception as error:
            permanent = isinstance(error, (ValueError, cloud_errors.BadRequest, cloud_errors.Forbidden,
                                           cloud_errors.NotFound, cloud_errors.Unauthorized))
            self.repository.fail_photo_job(report_id, token, type(error).__name__, permanent=permanent)
            logger.warning("Photo job failed report=%s error=%s permanent=%s elapsed=%.2fs", report_id, type(error).__name__, permanent, time.monotonic() - started)
        return True


def main():
    parser = argparse.ArgumentParser(description="Compress and upload report photos")
    parser.add_argument("--once", action="store_true", help="Process at most one ready job")
    parser.add_argument("--retry-failed", type=UUID, metavar="REPORT_ID", help="Requeue one failed photo, then exit")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = get_settings()
    repository = Repository(settings.connection_url())
    client = None
    try:
        repository.open()
        check_database(repository)
        if args.retry_failed:
            if not repository.retry_photo_job(args.retry_failed):
                parser.exit(1, "No failed photo job found for that report.\n")
            logger.info("Requeued photo for report %s", args.retry_failed)
            return
        client = create_storage_client(settings)
        check_photo_storage(settings, client)
        logger.info("Photo worker ready; polling every 2 seconds once=%s", args.once)
        worker = PhotoWorker(repository, client)
        last_idle_log = 0.0
        while True:
            try:
                worked = worker.process_one()
            except (psycopg.Error, PoolTimeout):
                logger.warning("Photo worker database unavailable; will retry")
                worked = False
            if args.once:
                return
            if not worked:
                if time.monotonic() - last_idle_log >= 30:
                    logger.info("Photo worker idle or database unavailable; next poll in 2 seconds")
                    last_idle_log = time.monotonic()
                time.sleep(2)
    except KeyboardInterrupt:
        pass
    finally:
        if client:
            client.close()
        repository.close()


if __name__ == "__main__":
    main()
