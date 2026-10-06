"""Pure functions that turn raw readings into twin state.

Kept free of FastAPI/SQLAlchemy so the rules are trivially unit-testable.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

from app.domain.enums import Condition, DataCompleteness, Freshness, Quality


@dataclass(frozen=True)
class Thresholds:
    warn_low: float | None = None
    warn_high: float | None = None
    crit_low: float | None = None
    crit_high: float | None = None


def evaluate_freshness(
    *,
    latest_observed_at: datetime | None,
    latest_quality: Quality | None,
    as_of: datetime,
    stale_after_seconds: int,
) -> Freshness:
    if latest_observed_at is None or latest_quality is None:
        return Freshness.MISSING
    if latest_quality == Quality.MISSING:
        return Freshness.MISSING
    age = (as_of - latest_observed_at).total_seconds()
    return Freshness.STALE if age > stale_after_seconds else Freshness.FRESH


def evaluate_condition(
    *,
    value: float | None,
    quality: Quality | None,
    freshness: Freshness,
    thresholds: Thresholds,
) -> Condition:
    """Threshold check. Unusable data yields UNKNOWN — never a guessed NORMAL."""
    if freshness == Freshness.MISSING or value is None or quality in (None, Quality.MISSING, Quality.BAD):
        return Condition.UNKNOWN
    t = thresholds
    if (t.crit_low is not None and value <= t.crit_low) or (t.crit_high is not None and value >= t.crit_high):
        return Condition.CRITICAL
    if (t.warn_low is not None and value <= t.warn_low) or (t.warn_high is not None and value >= t.warn_high):
        return Condition.WARNING
    return Condition.NORMAL


def rollup_condition(conditions: Iterable[Condition]) -> Condition:
    """Worst known condition wins; UNKNOWN only if nothing is known."""
    seen = set(conditions)
    for level in (Condition.CRITICAL, Condition.WARNING, Condition.NORMAL):
        if level in seen:
            return level
    return Condition.UNKNOWN


def rollup_completeness(freshness: Iterable[Freshness]) -> DataCompleteness:
    values = list(freshness)
    if not values or all(f == Freshness.MISSING for f in values):
        return DataCompleteness.NO_DATA
    if all(f == Freshness.FRESH for f in values):
        return DataCompleteness.COMPLETE
    return DataCompleteness.PARTIAL
