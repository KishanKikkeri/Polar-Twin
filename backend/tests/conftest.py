"""Shared fixtures. Tests use in-memory SQLite and never touch a live station or Postgres."""

import os
from collections.abc import Iterator
from datetime import UTC, datetime

# Must be set before app modules read settings.
os.environ.setdefault("POLARTWIN_ENVIRONMENT", "test")
os.environ.setdefault("POLARTWIN_DATABASE_URL", "sqlite://")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import build_engine, get_db
from app.main import create_app
from app.seed.seeder import seed

# Fixed reference time so freshness assertions are deterministic.
NOW = datetime(2026, 10, 6, 12, 0, 0, tzinfo=UTC)
NOW_ISO = NOW.isoformat()


def _make_engine() -> Engine:
    engine = build_engine("sqlite://", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return engine


def _client_for(engine: Engine) -> TestClient:
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def _override() -> Iterator[Session]:
        s = factory()
        try:
            yield s
        finally:
            s.close()

    app = create_app()
    app.dependency_overrides[get_db] = _override
    return TestClient(app)


@pytest.fixture(scope="session")
def seeded_engine() -> Engine:
    engine = _make_engine()
    with Session(engine) as s:
        seed(s, now=NOW)
    return engine


@pytest.fixture(scope="session")
def client(seeded_engine: Engine) -> TestClient:
    """Read-only client over a shared seeded DB. Do not mutate data through it."""
    return _client_for(seeded_engine)


@pytest.fixture()
def fresh_engine() -> Engine:
    """Isolated seeded DB for tests that insert data."""
    engine = _make_engine()
    with Session(engine) as s:
        seed(s, now=NOW)
    return engine


@pytest.fixture()
def fresh_client(fresh_engine: Engine) -> TestClient:
    return _client_for(fresh_engine)


@pytest.fixture()
def fresh_session(fresh_engine: Engine) -> Iterator[Session]:
    with Session(fresh_engine) as s:
        yield s


@pytest.fixture()
def empty_engine() -> Engine:
    return _make_engine()
