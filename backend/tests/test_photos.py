import base64
import hashlib
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from google.api_core import exceptions as cloud_errors
from PIL import Image
from pydantic import ValidationError

from app import photos
from app.database import Repository
from app.main import app
from app.models import Analysis, ReportInput
from app.photo_worker import ObjectConflict, PhotoWorker, upload_photo


def jpeg(size=(60, 40), orientation=None):
    image = Image.new("RGB", size, "gray")
    output = BytesIO()
    exif = image.getexif()
    if orientation:
        exif[274] = orientation
        exif[270] = "private metadata"
    image.save(output, "JPEG", exif=exif.tobytes())
    return output.getvalue()


def payload(photo=None):
    body = {"audio_transcription": "A pothole.", "video_transcription": "Damaged road.",
            "latitude": 45., "longitude": -73.}
    if photo is not None:
        body["photo_base64"] = photo
    return body


def test_jpeg_validation_and_model_private_bytes(monkeypatch):
    data = jpeg()
    encoded = base64.b64encode(data).decode()
    report = ReportInput(**payload(encoded))
    assert report.photo_bytes == data
    assert "private metadata" not in repr(report)
    for value in ["!", "data:image/jpeg;base64," + encoded, "", base64.b64encode(b"fake JPEG").decode(),
                  base64.b64encode(data[:30]).decode()]:
        with pytest.raises(ValidationError):
            ReportInput(**payload(value))
    png = BytesIO(); Image.new("RGB", (10, 10)).save(png, "PNG")
    with pytest.raises(ValueError):
        photos.decode_photo(base64.b64encode(png.getvalue()).decode())
    monkeypatch.setattr(photos, "MAX_PIXELS", 100)
    with pytest.raises(ValueError):
        photos.validate_jpeg(data)


def test_photo_byte_limit():
    with pytest.raises(ValueError):
        photos.validate_jpeg(b"\xff\xd8" + b"x" * photos.MAX_PHOTO_BYTES)
    with pytest.raises(ValueError):
        photos.decode_photo("A" * (photos.MAX_PHOTO_BASE64 + 1))


def test_compression_orientation_dimensions_metadata_and_no_upscaling():
    compressed = photos.compress_photo(jpeg((2400, 1200), orientation=6))
    with Image.open(BytesIO(compressed)) as image:
        assert image.size == (640, 1280)
        assert image.mode == "RGB" and image.format == "JPEG"
        assert not image.getexif()
        assert "icc_profile" not in image.info
    with Image.open(BytesIO(photos.compress_photo(jpeg((60, 40))))) as image:
        assert image.size == (60, 40)


@pytest.fixture
def api(monkeypatch):
    pipeline, repository = Mock(), Mock()
    pipeline.process.return_value = ("Pothole", Analysis(issue="Pothole", severity_score=5,
        ai_confidence=.8, cost_roi_value="Medium", tag="roads"))
    monkeypatch.setattr(app.state, "pipeline", pipeline, raising=False)
    monkeypatch.setattr(app.state, "repository", repository, raising=False)
    monkeypatch.setattr(app.state, "gcs_bucket_name", "private-bucket", raising=False)
    return SimpleNamespace(client=TestClient(app), pipeline=pipeline, repository=repository)


def test_api_accepts_photo_and_only_acknowledges_durable_job(api):
    data = jpeg()
    response = api.client.post("/api/v1/reports", json=payload(base64.b64encode(data).decode()))
    assert response.status_code == 201 and response.json() == {"status": "success"}
    saved = api.repository.save.call_args
    assert saved.args[0].photo_bytes == data
    assert saved.kwargs == {"bucket_name": "private-bucket"}
    assert "photo_base64" not in response.text


def test_photo_without_config_is_rejected_before_ai_but_legacy_post_still_works(api, monkeypatch):
    monkeypatch.setattr(app.state, "gcs_bucket_name", None)
    assert api.client.post("/api/v1/reports", json=payload(base64.b64encode(jpeg()).decode())).status_code == 503
    api.pipeline.process.assert_not_called(); api.repository.save.assert_not_called()
    assert api.client.post("/api/v1/reports", json=payload()).status_code == 201
    assert api.repository.save.call_args.kwargs == {}


def test_bad_image_does_not_echo_data_or_call_ai(api):
    response = api.client.post("/api/v1/reports", json=payload("not-an-image"))
    assert response.status_code == 422 and response.json() == {"detail": "Invalid request data"}
    api.pipeline.process.assert_not_called()


def test_photo_never_enters_analysis_prompt():
    from app.pipeline import Pipeline
    pipeline = Pipeline.__new__(Pipeline)
    pipeline.generate = Mock(side_effect=[SimpleNamespace(text="Pothole"), SimpleNamespace(text=
        '{"issue":"Pothole","severity_score":5,"ai_confidence":0.8,"cost_roi_value":"Low","tag":"roads"}')])
    encoded = base64.b64encode(jpeg()).decode()
    pipeline.process(ReportInput(**payload(encoded)))
    prompt = pipeline.generate.call_args_list[0].args[0]
    assert "A pothole." in prompt and "photo_base64" not in prompt and encoded not in prompt


def test_report_and_photo_job_use_the_same_transaction():
    report_id = uuid4()
    repo = Repository.__new__(Repository); repo.pool = MagicMock()
    connection = repo.pool.connection.return_value.__enter__.return_value
    connection.execute.return_value.fetchone.return_value = {"id": report_id}
    report = ReportInput(**payload(base64.b64encode(jpeg()).decode()))
    analysis = Analysis(issue="Pothole", severity_score=5, ai_confidence=.8, cost_roi_value="Low", tag="roads")
    assert repo.save(report, "Summary", analysis, bucket_name="private-bucket") == report_id
    assert repo.pool.connection.call_count == 1
    inserts = connection.execute.call_args_list
    assert "INSERT INTO municipal_reports" in inserts[0].args[0]
    assert "photo_status = 'pending'" in inserts[1].args[0]
    assert inserts[2].args[1] == (report_id, "private-bucket", f"reports/{report_id}/photo.jpg", report.photo_bytes)
    repo.pool.connection.return_value.__exit__.assert_called_once_with(None, None, None)


def job():
    return {"report_id": uuid4(), "lease_token": uuid4(), "source_bytes": jpeg(), "compressed_bytes": None,
            "bucket_name": "private-bucket", "object_name": "reports/id/photo.jpg", "attempts": 1}


def worker():
    repo, client = Mock(), Mock()
    repo.claim_photo_job.return_value = job()
    repo.prepare_photo_job.return_value = True
    repo.complete_photo_job.return_value = True
    return PhotoWorker(repo, client), repo, client.bucket.return_value.blob.return_value


def test_worker_stages_compressed_bytes_before_upload_and_completes(caplog):
    caplog.set_level("INFO", logger="app.photo_worker")
    instance, repo, blob = worker()
    order = []
    repo.prepare_photo_job.side_effect = lambda *args: order.append("stage") or True
    blob.upload_from_string.side_effect = lambda *args, **kwargs: order.append("upload")
    repo.complete_photo_job.side_effect = lambda *args: order.append("commit") or True
    assert instance.process_one()
    assert order == ["stage", "upload", "commit"]
    data = repo.prepare_photo_job.call_args.args[2]
    assert hashlib.sha256(data).hexdigest() == repo.prepare_photo_job.call_args.args[3]
    assert blob.upload_from_string.call_args.kwargs["if_generation_match"] == 0
    assert repo.complete_photo_job.call_args.args[2] == "gs://private-bucket/reports/id/photo.jpg"
    repo.fail_photo_job.assert_not_called()
    assert "Claimed photo" in caplog.text
    assert "Compressed photo" in caplog.text
    assert "Uploading staged photo" in caplog.text
    assert "uploaded and acknowledged" in caplog.text


@pytest.mark.parametrize("error,permanent", [(cloud_errors.ServiceUnavailable("down"), False),
                                            (cloud_errors.Forbidden("denied"), True)])
def test_worker_failures_are_retryable_or_permanent(error, permanent):
    instance, repo, blob = worker()
    blob.upload_from_string.side_effect = error
    instance.process_one()
    assert repo.fail_photo_job.call_args.kwargs == {"permanent": permanent}
    repo.complete_photo_job.assert_not_called()


def test_worker_reuses_staged_photo_after_restart(monkeypatch):
    instance, repo, blob = worker()
    staged = photos.compress_photo(jpeg())
    repo.claim_photo_job.return_value["compressed_bytes"] = staged
    monkeypatch.setattr("app.photo_worker.compress_photo", Mock(side_effect=AssertionError("Must reuse staged bytes")))
    assert instance.process_one()
    assert blob.upload_from_string.call_args.args[0] == staged


def test_worker_fences_expired_lease_before_upload():
    instance, repo, blob = worker()
    repo.prepare_photo_job.return_value = False
    assert instance.process_one()
    blob.upload_from_string.assert_not_called(); repo.complete_photo_job.assert_not_called()


def test_upload_replay_verifies_existing_object_and_rejects_collision():
    data = photos.compress_photo(jpeg()); digest = hashlib.sha256(data).hexdigest(); item = job()
    client = Mock(); blob = client.bucket.return_value.blob.return_value
    blob.upload_from_string.side_effect = cloud_errors.PreconditionFailed("exists")
    def reload(**kwargs):
        blob.metadata = {"report_id": str(item["report_id"]), "sha256": digest}
        blob.size = len(data)
        blob.md5_hash = base64.b64encode(hashlib.md5(data, usedforsecurity=False).digest()).decode()
    blob.reload.side_effect = reload
    assert upload_photo(client, item, data, digest) == "gs://private-bucket/reports/id/photo.jpg"
    blob.reload.side_effect = lambda **kwargs: setattr(blob, "metadata", {"sha256": "other"})
    with pytest.raises(ObjectConflict):
        upload_photo(client, item, data, digest)


def test_worker_leaves_job_recoverable_when_database_fails_after_upload():
    import psycopg
    instance, repo, blob = worker()
    repo.complete_photo_job.side_effect = psycopg.OperationalError("disconnected")
    with pytest.raises(psycopg.OperationalError):
        instance.process_one()
    blob.upload_from_string.assert_called_once(); repo.fail_photo_job.assert_not_called()


def test_request_body_limit_before_parsing(api):
    response = api.client.post("/api/v1/reports", content=b"x" * (8 * 1024 * 1024 + 1),
                               headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    api.pipeline.process.assert_not_called()
