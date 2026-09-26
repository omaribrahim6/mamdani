from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parents[1] / ".env", extra="ignore", hide_input_in_errors=True)

    database_url: str = Field(min_length=1, repr=False)
    database_ssl_root_cert: str | None = None
    google_cloud_project: str = Field(min_length=1)
    google_cloud_location: str = "us-central1"
    gemini_model: str = Field(min_length=1)
    gemini_live_model: str = "gemini-live-2.5-flash-native-audio"
    gcs_bucket_name: str | None = None
    google_application_credentials: str | None = Field(default=None, repr=False)
    auth0_domain: str = Field(min_length=1)
    auth0_audience: str = Field(min_length=1)

    @field_validator("database_url", "google_cloud_project", "google_cloud_location", "gemini_model", "gemini_live_model", "auth0_domain", "auth0_audience")
    @classmethod
    def required_value(cls, value: str) -> str:
        value = value.strip()
        if not value or value.startswith(("your-", "postgresql://user:password@host")):
            raise ValueError("Set a real value instead of an empty value or example placeholder")
        return value

    @field_validator("gcs_bucket_name", "google_application_credentials", "database_ssl_root_cert")
    @classmethod
    def optional_value(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None

    @field_validator("google_application_credentials", "database_ssl_root_cert")
    @classmethod
    def existing_file(cls, value: str | None) -> str | None:
        if value is not None:
            path = Path(value).expanduser()
            if not path.is_file():
                raise ValueError("Configured file does not exist")
            return str(path)
        return value

    @field_validator("auth0_domain")
    @classmethod
    def validate_domain(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if ":" in value or "/" in value or "?" in value or "#" in value or not value:
            raise ValueError("AUTH0_DOMAIN must be a hostname without a scheme or path")
        return value

    def connection_url(self) -> str:
        url = urlsplit(self.database_url)
        if url.scheme not in {"postgres", "postgresql"} or not url.hostname:
            raise ValueError("DATABASE_URL must be a PostgreSQL URL")
        params = dict(parse_qsl(url.query))
        if url.hostname not in {"localhost", "127.0.0.1", "::1"}:
            params["sslmode"] = "verify-full"
            if self.database_ssl_root_cert:
                params["sslrootcert"] = self.database_ssl_root_cert
        return urlunsplit(url._replace(query=urlencode(params)))

    def genai_options(self) -> dict:
        """Explicit Vertex routing; a stale API key must never select Developer API."""
        options = {"vertexai": True, "project": self.google_cloud_project,
                   "location": self.google_cloud_location}
        if self.google_application_credentials:
            import google.auth
            credentials, _ = google.auth.load_credentials_from_file(
                self.google_application_credentials,
                scopes=["https://www.googleapis.com/auth/cloud-platform"])
            options["credentials"] = credentials
        return options


@lru_cache
def get_settings() -> Settings:
    return Settings()
