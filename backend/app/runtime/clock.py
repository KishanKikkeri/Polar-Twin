"""Simulation clock.

The runtime never calls ``datetime.now()`` directly; it asks a ``Clock``.

* ``SimulationClock`` — logical time advanced explicitly by ``advance()``.
  Used by tests and by the runtime in ``accelerated`` mode.
* ``realtime`` mode is the same clock, advanced by the runtime only up to
  the wall clock (catch-up), so history stays queryable with ``as_of=now``.
"""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from app.core.timeutil import ensure_utc


class SimulationClock:
    def __init__(self, start: datetime, step_seconds: int = 60):
        if step_seconds <= 0:
            raise ValueError("step_seconds must be positive")
        self._start = ensure_utc(start)
        self._now = self._start
        self.step = timedelta(seconds=step_seconds)
        self.ticks = 0

    @property
    def start(self) -> datetime:
        return self._start

    def now(self) -> datetime:
        return self._now

    def advance(self, steps: int = 1) -> datetime:
        if steps < 0:
            raise ValueError("the simulation clock never runs backwards")
        self._now = self._now + self.step * steps
        self.ticks += steps
        return self._now

    def steps_behind(self, wall_now: datetime) -> int:
        """How many whole steps the clock lags ``wall_now`` (realtime catch-up)."""
        lag = (ensure_utc(wall_now) - self._now).total_seconds()
        return max(0, int(lag // self.step.total_seconds()))


def aligned(ts: datetime, step_seconds: int) -> datetime:
    """Floor ``ts`` to a multiple of ``step_seconds`` since the epoch (deterministic grids)."""
    epoch = int(ensure_utc(ts).timestamp())
    return datetime.fromtimestamp(epoch - epoch % step_seconds, tz=UTC)


WallClock = Callable[[], datetime]


def system_wall_clock() -> datetime:
    return datetime.now(UTC)
