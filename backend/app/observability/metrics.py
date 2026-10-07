"""Dependency-free metrics registry (counters, gauges, histograms).

Rendered as Prometheus text exposition at ``GET /metrics`` and as JSON in the
runtime status endpoint. Thread-safe: the runtime ticks in a worker thread
while request handlers read.
"""

import math
import threading
from bisect import bisect_left
from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

LabelKey = tuple[tuple[str, str], ...]

DEFAULT_LATENCY_BUCKETS = (0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0)


def _key(labels: dict[str, str] | None) -> LabelKey:
    return tuple(sorted((k, str(v)) for k, v in (labels or {}).items()))


def _fmt_labels(key: LabelKey, extra: dict[str, str] | None = None) -> str:
    items = list(key) + sorted((extra or {}).items())
    if not items:
        return ""
    body = ",".join(f'{k}="{str(v).replace(chr(92), chr(92) * 2).replace(chr(34), chr(92) + chr(34))}"' for k, v in items)
    return "{" + body + "}"


@dataclass
class _Metric:
    name: str
    help: str
    kind: str
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)


@dataclass
class Counter(_Metric):
    values: dict[LabelKey, float] = field(default_factory=dict)

    def inc(self, amount: float = 1.0, **labels: str) -> None:
        if amount < 0:
            raise ValueError("counters only increase")
        k = _key(labels)
        with self.lock:
            self.values[k] = self.values.get(k, 0.0) + amount

    def get(self, **labels: str) -> float:
        return self.values.get(_key(labels), 0.0)

    def total(self) -> float:
        return sum(self.values.values())


@dataclass
class Gauge(_Metric):
    values: dict[LabelKey, float] = field(default_factory=dict)

    def set(self, value: float, **labels: str) -> None:
        with self.lock:
            self.values[_key(labels)] = float(value)

    def get(self, **labels: str) -> float | None:
        return self.values.get(_key(labels))


@dataclass
class Histogram(_Metric):
    buckets: tuple[float, ...] = DEFAULT_LATENCY_BUCKETS
    series: dict[LabelKey, dict[str, Any]] = field(default_factory=dict)
    window: int = 2048  # recent samples kept for quantiles

    def observe(self, value: float, **labels: str) -> None:
        k = _key(labels)
        with self.lock:
            s = self.series.get(k)
            if s is None:
                s = {"counts": [0] * (len(self.buckets) + 1), "sum": 0.0, "count": 0, "recent": deque(maxlen=self.window)}
                self.series[k] = s
            s["counts"][bisect_left(self.buckets, value)] += 1
            s["sum"] += value
            s["count"] += 1
            s["recent"].append(value)

    def quantile(self, q: float, **labels: str) -> float | None:
        s = self.series.get(_key(labels))
        if not s or not s["recent"]:
            return None
        data = sorted(s["recent"])
        idx = min(len(data) - 1, max(0, math.ceil(q * len(data)) - 1))
        return data[idx]

    def summary(self, **labels: str) -> dict[str, float | int | None]:
        s = self.series.get(_key(labels))
        if not s:
            return {"count": 0, "sum": 0.0, "p50": None, "p95": None, "p99": None}
        return {
            "count": s["count"],
            "sum": round(s["sum"], 6),
            "p50": self.quantile(0.5, **labels),
            "p95": self.quantile(0.95, **labels),
            "p99": self.quantile(0.99, **labels),
        }


class MetricsRegistry:
    def __init__(self) -> None:
        self._metrics: dict[str, _Metric] = {}
        self._lock = threading.Lock()
        self.recent_errors: deque[dict[str, Any]] = deque(maxlen=50)

    def _get_or_create(self, cls, name: str, help: str, **kw) -> Any:
        with self._lock:
            m = self._metrics.get(name)
            if m is None:
                m = cls(name=name, help=help, kind=cls.__name__.lower(), **kw)
                self._metrics[name] = m
            return m

    def counter(self, name: str, help: str = "") -> Counter:
        return self._get_or_create(Counter, name, help)

    def gauge(self, name: str, help: str = "") -> Gauge:
        return self._get_or_create(Gauge, name, help)

    def histogram(self, name: str, help: str = "", buckets: Iterable[float] = DEFAULT_LATENCY_BUCKETS) -> Histogram:
        return self._get_or_create(Histogram, name, help, buckets=tuple(buckets))

    def record_error(self, component: str, error: str, **context: Any) -> None:
        self.counter("polartwin_errors_total", "Errors by component").inc(component=component)
        self.recent_errors.append(
            {"at": datetime.now(UTC).isoformat(), "component": component, "error": error, **context}
        )

    def render_prometheus(self) -> str:
        lines: list[str] = []
        for m in sorted(self._metrics.values(), key=lambda x: x.name):
            lines.append(f"# HELP {m.name} {m.help}")
            if isinstance(m, Counter):
                lines.append(f"# TYPE {m.name} counter")
                for k, v in sorted(m.values.items()):
                    lines.append(f"{m.name}{_fmt_labels(k)} {v}")
            elif isinstance(m, Gauge):
                lines.append(f"# TYPE {m.name} gauge")
                for k, v in sorted(m.values.items()):
                    lines.append(f"{m.name}{_fmt_labels(k)} {v}")
            elif isinstance(m, Histogram):
                lines.append(f"# TYPE {m.name} histogram")
                for k, s in sorted(m.series.items()):
                    cumulative = 0
                    for b, c in zip(m.buckets, s["counts"], strict=False):
                        cumulative += c
                        lines.append(f"{m.name}_bucket{_fmt_labels(k, {'le': repr(b)})} {cumulative}")
                    cumulative += s["counts"][-1]
                    lines.append(f"{m.name}_bucket{_fmt_labels(k, {'le': '+Inf'})} {cumulative}")
                    lines.append(f"{m.name}_sum{_fmt_labels(k)} {s['sum']}")
                    lines.append(f"{m.name}_count{_fmt_labels(k)} {s['count']}")
        return "\n".join(lines) + "\n"

    def reset(self) -> None:
        with self._lock:
            self._metrics.clear()
            self.recent_errors.clear()


# Process-wide default registry. Components accept an injected registry for tests.
REGISTRY = MetricsRegistry()
