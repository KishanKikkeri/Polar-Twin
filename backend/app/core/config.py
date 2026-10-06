"""Application configuration.

All settings are read from environment variables prefixed with
``POLARTWIN_`` (or from a local, git-ignored ``.env`` file). Nothing secret
is hard-coded here: the default database URL points at the throw-away local
development container defined in ``docker-compose.yml``.
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"],
        description="Origins allowed to call the API (Vite dev server by default).",
    )

    telemetry_default_limit: int = 500
    telemetry_max_limit: int = 5000


@lru_cache
def get_settings() -> Settings:
    return Settings()
