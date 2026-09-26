"""Bounded, read-only service checks. Never include provider errors or secrets."""
import logging

import httpx
from google import genai
from google.cloud import storage

logger = logging.getLogger(__name__)


def check_database(repository):
    with repository.pool.connection() as connection:
        # Verify the columns needed by both ingestion and the photo queue.
        connection.execute("SELECT id, photo_status, photo_object FROM municipal_reports LIMIT 0")
        connection.execute("SELECT report_id, lease_token, compressed_bytes FROM report_photo_jobs LIMIT 0")
    logger.info("Startup check passed: database connection and photo schema")


def check_api_services(settings):
    setting = "Google Cloud Vertex AI credentials"
    try:
        with genai.Client(**settings.genai_options(), http_options={"timeout": 10000}) as client:
            for setting, name in (("GEMINI_MODEL", settings.gemini_model), ("GEMINI_LIVE_MODEL", settings.gemini_live_model)):
                client.models.get(model=name)
    except Exception as error:
        code = getattr(error, "code", None)
        hints = {
            400: "Check GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION and the Vertex model name.",
            401: "Check Google Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS.",
            403: "Enable the Vertex AI API and billing; grant the credential identity Vertex AI User on GOOGLE_CLOUD_PROJECT.",
            404: "Check the Vertex model name and availability in GOOGLE_CLOUD_LOCATION for this project.",
            429: "Vertex AI quota/rate limit reached; check project quota and retry later.",
        }
        hint = hints.get(code, "Check network connectivity and Gemini service availability.")
        status = f"HTTP {code}" if isinstance(code, int) else type(error).__name__
        raise RuntimeError(f"Startup check failed: {setting} ({status}). {hint}") from None
    logger.info("Startup check passed: Vertex AI credentials and model availability")
    if settings.auth0_domain == "localhost":
        logger.warning("Startup: local Auth0 defaults; authenticated report listing requires a real Auth0 tenant")
        return
    try:
        with httpx.Client(timeout=10) as client:
            response = client.get(f"https://{settings.auth0_domain}/.well-known/jwks.json")
            response.raise_for_status()
            if not response.json().get("keys"):
                raise ValueError("No signing keys")
    except Exception as error:
        raise RuntimeError(f"Startup check failed: AUTH0_DOMAIN signing keys ({type(error).__name__})") from None
    logger.info("Startup check passed: Auth0 signing keys (audience requires a real token to verify)")


def create_storage_client(settings):
    try:
        return (storage.Client.from_service_account_json(settings.google_application_credentials)
                if settings.google_application_credentials else storage.Client())
    except Exception as error:
        raise RuntimeError(f"Startup check failed: Google storage credentials ({type(error).__name__})") from None


def check_photo_storage(settings, client):
    if not settings.gcs_bucket_name:
        raise RuntimeError("Startup check failed: set GCS_BUCKET_NAME for the photo worker")
    permissions = {"storage.objects.create", "storage.objects.get"}
    try:
        granted = client.bucket(settings.gcs_bucket_name).test_iam_permissions(
            sorted(permissions), timeout=10, retry=None)
    except Exception as error:
        raise RuntimeError(f"Startup check failed: GCS_BUCKET_NAME object create/read permissions ({type(error).__name__})") from None
    missing = permissions - set(granted)
    if missing:
        raise RuntimeError("Startup check failed: GCS_BUCKET_NAME object create/read permissions; missing "
                           + ", ".join(sorted(missing))
                           + ". Grant Storage Object Creator and Storage Object Viewer on this bucket to the credential identity.")
    logger.info("Startup check passed: photo bucket credentials and object create/read permissions")
