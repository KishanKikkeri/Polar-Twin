"""Timezone helpers. Every datetime crossing a boundary is timezone-aware UTC."""

from datetime import UTC, datetime


def utcnow() -> datetime:
    return datetime.now(UTC)


def ensure_utc(value: datetime) -> datetime:
    """Normalise an aware datetime to UTC; reject naive datetimes loudly."""
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        raise ValueError("naive datetime is not allowed; include a timezone offset")
    return value.astimezone(UTC)
