from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from google.genai import errors
from pydantic import ValidationError

from app.auth import Auth0Validator
from app.config import Settings
from app.models import Analysis, ReportInput
from app.pipeline import AIUnavailable, InvalidAIOutput, Pipeline


def pipeline():
    instance = Pipeline.__new__(Pipeline)
    instance.model = "test-model"
    instance.client = Mock()
    return instance


def test_pipeline_passes_summary_to_second_call():
    instance = pipeline()
    summary = "Audio claims a broken light; video describes an intact light. Damage uncertain."
    instance.client.models.generate_content.side_effect = [
        SimpleNamespace(text=summary),
        SimpleNamespace(text='{"issue":"Possible broken light","severity_score":2,"ai_confidence":0.4,"cost_roi_value":"Low","tag":"lights"}'),
    ]
    report = ReportInput(audio_transcription="Broken light", video_transcription="Intact light", latitude=45, longitude=-73)
    result, analysis = instance.process(report)
    assert result == summary
    assert analysis.ai_confidence == 0.4
    calls = instance.client.models.generate_content.call_args_list
    assert "Broken light" in calls[0].kwargs["contents"]
    assert "Damage uncertain" in calls[1].kwargs["contents"]
    assert calls[1].kwargs["config"].response_json_schema


@pytest.mark.parametrize("error", [errors.ClientError(429, {"error": {"message": "rate limit"}}), httpx.ReadTimeout("timeout")])
def test_retry_then_success(monkeypatch, error):
    instance = pipeline()
    instance.client.models.generate_content.side_effect = [error, SimpleNamespace(text="ok")]
    sleep = Mock()
    monkeypatch.setattr("app.pipeline.time.sleep", sleep)
    assert instance.generate("input", None).text == "ok"
    assert instance.client.models.generate_content.call_count == 2
    sleep.assert_called_once()


def test_retry_exhaustion(monkeypatch):
    instance = pipeline()
    instance.client.models.generate_content.side_effect = httpx.ReadTimeout("timeout")
    sleep = Mock()
    monkeypatch.setattr("app.pipeline.time.sleep", sleep)
    with pytest.raises(AIUnavailable):
        instance.generate("input", None)
    assert instance.client.models.generate_content.call_count == 3
    assert sleep.call_count == 2


@pytest.mark.parametrize("output", ["", "not JSON", '{"tag":"other"}'])
def test_invalid_output_rejected(output):
    instance = pipeline()
    instance.client.models.generate_content.side_effect = [SimpleNamespace(text="Summary"), SimpleNamespace(text=output)]
    with pytest.raises(InvalidAIOutput):
        instance.process(ReportInput(audio_transcription="Report", video_transcription="", latitude=45, longitude=-73))


def test_invalid_tag_and_severity_are_rejected():
    base = dict(issue="Issue", severity_score=1, ai_confidence=0.5, cost_roi_value="Low", tag="roads")
    for changes in ({"tag": "other"}, {"severity_score": 1.5}, {"ai_confidence": float("nan")}):
        with pytest.raises(ValidationError):
            Analysis(**(base | changes))


@pytest.mark.parametrize("changes", [{}, {"aud": "wrong"}, {"iss": "https://wrong/"}, {"exp": 1}])
def test_auth0_signed_tokens(changes):
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    validator = Auth0Validator("tenant.auth0.com", "municipal-api")
    validator.jwks = Mock()
    validator.jwks.get_signing_key_from_jwt.return_value = SimpleNamespace(key=private_key.public_key())
    claims = {"sub": "resident", "iss": "https://tenant.auth0.com/", "aud": "municipal-api", "exp": 4_102_444_800} | changes
    token = jwt.encode(claims, private_key, algorithm="RS256", headers={"kid": "test"})
    if changes:
        with pytest.raises(jwt.InvalidTokenError):
            validator.validate(token)
    else:
        assert validator.validate(token)["sub"] == "resident"


def test_remote_database_requires_verified_tls():
    settings = Settings(database_url="postgresql://user:pw@db.example.com/db?sslmode=disable", google_cloud_project="test",
                        gemini_model="test", auth0_domain="tenant.auth0.com", auth0_audience="api")
    assert "sslmode=verify-full" in settings.connection_url()
