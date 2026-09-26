from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from app.config import Settings
from app import startup


def settings(**changes):
    return Settings(_env_file=None, **(dict(database_url="postgresql://localhost/test", google_cloud_project="test-project",
        gemini_model="test-model", gemini_live_model="test-live", auth0_domain="localhost",
        auth0_audience="local", gcs_bucket_name="test-bucket") | changes))


@pytest.mark.parametrize("key,value", [("google_cloud_project", " "), ("auth0_domain", "your-tenant.auth0.com"),
                                      ("gemini_live_model", ""), ("google_application_credentials", "/missing/credentials.json")])
def test_bad_configuration_fails_without_echoing_values(key, value):
    with pytest.raises(ValidationError) as caught:
        settings(**{key: value})
    assert "input_value" not in str(caught.value)


def test_blank_optional_files_are_unset():
    config = settings(google_application_credentials="", database_ssl_root_cert=" ")
    assert config.google_application_credentials is None
    assert config.database_ssl_root_cert is None


def test_gemini_checks_models_and_redacts_provider_errors(monkeypatch):
    client = Mock()
    factory = Mock()
    factory.return_value.__enter__ = Mock(return_value=client)
    factory.return_value.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(startup.genai, "Client", factory)
    startup.check_api_services(settings())
    assert [call.kwargs["model"] for call in client.models.get.call_args_list] == ["test-model", "test-live"]
    client.models.get.side_effect = ValueError("secret-key")
    with pytest.raises(RuntimeError, match="GEMINI_MODEL") as caught:
        startup.check_api_services(settings())
    assert "secret-key" not in str(caught.value)


def test_vertex_permission_failure_reports_actionable_reason(monkeypatch):
    from google.genai.errors import ClientError
    client = Mock()
    factory = Mock()
    factory.return_value.__enter__ = Mock(return_value=client)
    factory.return_value.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(startup.genai, "Client", factory)
    client.models.get.side_effect = ClientError(403, {"error": {
        "message": "Requests to ModelService.GetModel are blocked. secret-key", "status": "PERMISSION_DENIED"}})
    with pytest.raises(RuntimeError, match="HTTP 403") as caught:
        startup.check_api_services(settings())
    assert "Vertex AI User" in str(caught.value)
    assert "secret-key" not in str(caught.value)


def test_vertex_options_use_project_region_and_ignore_old_key(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "stale-key")
    monkeypatch.setenv("GOOGLE_API_KEY", "another-stale-key")
    assert settings().genai_options() == {
        "vertexai": True, "project": "test-project", "location": "us-central1"}


def test_vertex_loads_dotenv_credential_file(monkeypatch, tmp_path):
    path = tmp_path / "credentials.json"
    path.write_text('{}')
    import google.auth
    credentials = Mock()
    loader = Mock(return_value=(credentials, "credential-project"))
    monkeypatch.setattr(google.auth, "load_credentials_from_file", loader)
    options = settings(google_application_credentials=str(path)).genai_options()
    assert options["credentials"] is credentials
    assert options["project"] == "test-project"
    assert "api_key" not in options
    loader.assert_called_once_with(str(path), scopes=["https://www.googleapis.com/auth/cloud-platform"])


def test_photo_bucket_requires_create_and_read_permissions():
    client = Mock()
    bucket = client.bucket.return_value
    bucket.test_iam_permissions.return_value = ["storage.objects.create"]
    with pytest.raises(RuntimeError, match="create/read permissions"):
        startup.check_photo_storage(settings(), client)
    bucket.test_iam_permissions.return_value.append("storage.objects.get")
    startup.check_photo_storage(settings(), client)
    bucket.test_iam_permissions.assert_called_with(["storage.objects.create", "storage.objects.get"], timeout=10, retry=None)
    with pytest.raises(RuntimeError, match="set GCS_BUCKET_NAME"):
        startup.check_photo_storage(settings(gcs_bucket_name=""), client)
