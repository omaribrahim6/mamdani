from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import jwt
import psycopg
import pytest
from fastapi.testclient import TestClient

from app import auth
from app.main import app
from app.models import Analysis
from app.pipeline import AIUnavailable, InvalidAIOutput


@pytest.fixture
def client(monkeypatch):
    pipeline = Mock()
    pipeline.process.return_value = ("Pothole in the road.", Analysis(
        issue="Road pothole", severity_score=6, ai_confidence=0.85,
        cost_roi_value="Medium", tag="roads",
    ))
    repository = Mock()
    repository.list.return_value = []
    app.state.pipeline = pipeline
    app.state.repository = repository
    validator = Mock()
    validator.validate.return_value = {"sub": "resident"}
    monkeypatch.setattr(auth, "get_validator", lambda: validator)
    # No lifespan: external services are explicitly replaced with mocks.
    return SimpleNamespace(http=TestClient(app), pipeline=pipeline, repository=repository, validator=validator)


def payload():
    return {"audio_transcription": "There is a pothole.", "video_transcription": "",
            "latitude": 45.5017, "longitude": -73.5673}


def test_post_is_public_and_only_acknowledges_committed_report(client):
    response = client.http.post("/api/v1/reports", json=payload())
    assert response.status_code == 201
    assert response.json() == {"status": "success"}
    client.validator.validate.assert_not_called()
    client.repository.save.assert_called_once()


@pytest.mark.parametrize("changes", [
    {"audio_transcription": " ", "video_transcription": ""},
    {"latitude": 91}, {"longitude": -181}, {"latitude": "45"},
    {"audio_transcription": "a" * 20_001}, {"unknown": "value"},
])
def test_invalid_input_never_calls_ai(client, changes):
    response = client.http.post("/api/v1/reports", json=payload() | changes)
    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid request data"}
    client.pipeline.process.assert_not_called()


@pytest.mark.parametrize("error,expected", [
    (AIUnavailable(), 503), (InvalidAIOutput(), 502),
])
def test_failed_processing_does_not_save(client, error, expected):
    client.pipeline.process.side_effect = error
    response = client.http.post("/api/v1/reports", json=payload())
    assert response.status_code == expected
    client.repository.save.assert_not_called()


def test_failed_commit_does_not_acknowledge_success(client):
    client.repository.save.side_effect = psycopg.OperationalError("secret details")
    response = client.http.post("/api/v1/reports", json=payload())
    assert response.status_code == 503
    assert "secret" not in response.text


def test_get_requires_authentication(client):
    assert client.http.get("/api/v1/reports").status_code == 401
    client.repository.list.assert_not_called()


def test_get_rejects_invalid_token(client):
    client.validator.validate.side_effect = jwt.InvalidTokenError()
    assert client.http.get("/api/v1/reports", headers={"Authorization": "Bearer invalid"}).status_code == 401
    client.repository.list.assert_not_called()


def test_get_returns_stored_reports_and_filters(client):
    client.repository.list.return_value = [{
        "id": uuid4(), "created_at": datetime.now(timezone.utc),
        "raw_audio_text": "pothole", "raw_video_text": "", "standardized_situation": "Road damage",
        "issue": "Pothole", "severity_score": 6, "ai_confidence": 0.59,
        "cost_roi_value": "Medium", "tag": "roads", "status": "needs_review",
        "location": {"latitude": 45, "longitude": -73, "street_address": None},
    }]
    response = client.http.get("/api/v1/reports?tag=roads&min_severity=6", headers={"Authorization": "Bearer valid"})
    assert response.status_code == 200
    assert response.json()[0]["status"] == "needs_review"
    client.repository.list.assert_called_once_with("roads", 6)


@pytest.mark.parametrize("query", ["tag=other", "tag=roads%27", "min_severity=0", "min_severity=11"])
def test_invalid_filters(client, query):
    assert client.http.get("/api/v1/reports?" + query, headers={"Authorization": "Bearer valid"}).status_code == 422
    client.repository.list.assert_not_called()
