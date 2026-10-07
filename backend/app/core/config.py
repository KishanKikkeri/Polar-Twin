"""Application configuration.

All settings are read from environment variables prefixed with
``POLARTWIN_`` (or from a local, git-ignored ``.env`` file). Nothing secret
is hard-coded here: the default database URL points at the throw-away local
development container defined in ``docker-compose.yml``, and the auth secret
has no usable default outside development/test (see ``validate_for_runtime``).
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

# Marker value: refused at startup when environment == "production".
INSECURE_DEV_SECRET = "polartwin-dev-only-insecure-secret-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="POLARTWIN_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "POLARTWIN Digital Twin API"
    environment: str = Field(default="development", description="development | test | production")
    api_v1_prefix: str = "/api/v1"

    database_url: str = Field(
        default="postgresql+psycopg://polartwin:polartwin@localhost:5432/polartwin",
        description="SQLAlchemy URL. Local-dev default only; override in any shared environment.",
    )
    database_echo: bool = False
    timescaledb_enabled: bool = Field(
        default=True,
        description="Convert telemetry to a TimescaleDB hypertable when the extension is available "
        "(PostgreSQL only; silently skipped on SQLite or when the extension is not installed).",
    )

    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"],
        description="Origins allowed to call the API (Vite dev server by default).",
    )

    telemetry_default_limit: int = 500
    telemetry_max_limit: int = 5000

    # ---- logging / observability ------------------------------------------
    log_level: str = "INFO"
    log_json: bool = Field(default=True, description="Structured JSON logs (false = human-readable)")

    # ---- twin runtime -----------------------------------------------------
    runtime_enabled: bool = Field(
        default=False, description="Start the causal simulation + ingestion runtime with the API process."
    )
    runtime_clock_mode: Literal["realtime", "accelerated"] = Field(
        default="realtime",
        description="realtime: simulation time follows the wall clock (catch-up from start). "
        "accelerated: simulation time advances step_seconds per tick, decoupled from wall time.",
    )
    runtime_step_seconds: int = Field(default=60, ge=1, le=3600, description="Simulated seconds per step")
    runtime_tick_interval_seconds: float = Field(default=2.0, gt=0, description="Wall seconds between ticks")
    runtime_backfill_hours: float = Field(default=0.0, ge=0, le=72, description="Warm-start history to simulate")
    runtime_seed: int = Field(default=20261007, description="Deterministic simulation seed")
    runtime_stations: list[str] = Field(default_factory=lambda: ["maitri", "bharati"])
    runtime_buffer_capacity: int = Field(default=50_000, ge=100, description="Edge store-and-forward capacity")
    runtime_buffer_path: str | None = Field(
        default=None, description="SQLite file for durable edge buffering (None = in-memory)"
    )

    # ---- ingestion --------------------------------------------------------
    ingest_max_future_skew_seconds: int = 120
    ingest_max_lateness_seconds: int = 7 * 24 * 3600
    ingest_delayed_after_seconds: int = Field(
        default=300, description="received_at - observed_at above this marks an event DELAYED"
    )

    # ---- MQTT (optional; requires `pip install -r requirements-mqtt.txt`) --
    mqtt_enabled: bool = False
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    mqtt_username: str | None = None
    mqtt_password: SecretStr | None = None
    mqtt_topic_root: str = "polartwin/v1"
    mqtt_client_id: str = "polartwin-hq-ingest"
    mqtt_tls: bool = False

    # ---- security ---------------------------------------------------------
    auth_secret: SecretStr = Field(
        default=SecretStr(INSECURE_DEV_SECRET),
        description="HMAC key for HS256 bearer tokens. MUST be overridden outside development/test.",
    )
    auth_issuer: str = "polartwin"
    auth_audience: str = "polartwin-api"
    auth_token_ttl_seconds: int = 8 * 3600
    auth_public_reads: bool = Field(
        default=True,
        description="Allow unauthenticated read access to twin/telemetry/alerts (frontend has no login yet). "
        "Mutating and audit endpoints always require a token.",
    )

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    def validate_for_runtime(self) -> None:
        """Fail fast on insecure configuration in production."""
        if self.is_production:
            secret = self.auth_secret.get_secret_value()
            if secret == INSECURE_DEV_SECRET or len(secret) < 32:
                raise RuntimeError(
                    "POLARTWIN_AUTH_SECRET must be set to a random value of at least 32 characters in production"
                )


@lru_cache
def get_settings() -> Settings:
    return Settings()
