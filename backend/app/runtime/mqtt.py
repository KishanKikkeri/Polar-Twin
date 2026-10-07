"""MQTT-ready ingestion and transport abstraction.

Pipeline:
    MQTT Packet (topic + payload)
        ↓
    Normalizer
        ↓
    Validated TelemetryEvent
        ↓
    IngestionPipeline / Twin Runtime

Supports both real MQTT brokers (via Paho when installed) and a built-in
in-memory topic-matching broker for zero-infrastructure local runs and tests.
"""

import fnmatch
import json
import re
import threading
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from app.core.logging import get_logger
from app.core.timeutil import ensure_utc, utcnow
from app.domain.enums import Provenance, Quality
from app.runtime.telemetry_event import TelemetryEvent

logger = get_logger("polartwin.mqtt")


class MqttTopic:
    """Topic parser for POLARTWIN hierarchy: ``<root>/<station_id>/<asset_code>/<metric>``."""

    PATTERN = re.compile(r"^([^/]+)/([^/]+)/([^/]+)/([^/]+)$")

    def __init__(self, root: str = "polartwin/v1"):
        self.root = root.strip("/")

    def format(self, station_id: str, asset_code: str, metric: str) -> str:
        return f"{self.root}/{station_id}/{asset_code}/{metric}"

    def parse(self, topic: str) -> tuple[str, str, str] | None:
        """Returns (station_id, asset_code, metric) or None if format doesn't match."""
        topic_clean = topic.strip("/")
        if not topic_clean.startswith(self.root):
            return None
        sub = topic_clean[len(self.root) :].strip("/")
        parts = sub.split("/")
        if len(parts) == 3:
            return parts[0], parts[1], parts[2]
        return None


class MqttNormalizer:
    """Normalizes raw MQTT topic + payload into a canonical TelemetryEvent."""

    def __init__(self, topic_parser: MqttTopic | None = None):
        self.topic_parser = topic_parser or MqttTopic()

    def normalize(self, topic: str, raw_payload: bytes | str | dict[str, Any]) -> TelemetryEvent:
        parsed_topic = self.topic_parser.parse(topic)
        if not parsed_topic:
            raise ValueError(f"Unrecognized MQTT topic structure: '{topic}'")
        station_id, asset_code, metric = parsed_topic

        if isinstance(raw_payload, bytes):
            data = json.loads(raw_payload.decode("utf-8"))
        elif isinstance(raw_payload, str):
            data = json.loads(raw_payload)
        elif isinstance(raw_payload, dict):
            data = raw_payload
        else:
            raise TypeError(f"Unsupported payload type: {type(raw_payload)}")

        # Timestamp normalization
        raw_ts = data.get("observed_at") or data.get("timestamp") or data.get("ts") or utcnow()
        if isinstance(raw_ts, str):
            observed_at = datetime.fromisoformat(raw_ts.replace("Z", "+00:00"))
        elif isinstance(raw_ts, (int, float)):
            observed_at = datetime.fromtimestamp(raw_ts, tz=UTC)
        elif isinstance(raw_ts, datetime):
            observed_at = ensure_utc(raw_ts)
        else:
            observed_at = utcnow()

        # Quality normalization
        raw_quality = str(data.get("quality", "GOOD")).upper()
        quality = Quality(raw_quality) if raw_quality in Quality.__members__ else Quality.GOOD

        # Value normalization
        raw_val = data.get("value")
        val = float(raw_val) if raw_val is not None else None
        if quality == Quality.MISSING:
            val = None

        # Provenance normalization
        raw_prov = str(data.get("provenance", "SYNTHETIC")).upper()
        provenance = Provenance(raw_prov) if raw_prov in Provenance.__members__ else Provenance.SYNTHETIC

        unit = str(data.get("unit") or "")
        source = str(data.get("source") or f"mqtt:{station_id}")
        event_id = str(data.get("event_id") or data.get("id") or f"mqtt-{station_id}-{asset_code}-{metric}-{int(observed_at.timestamp())}")

        return TelemetryEvent(
            event_id=event_id,
            station_id=station_id,
            asset_id=f"{station_id}.{asset_code}",
            channel_id=f"{station_id}.{asset_code}.{metric}",
            metric=metric,
            unit=unit,
            observed_at=observed_at,
            value=val,
            provenance=provenance,
            quality=quality,
            source=source,
            sequence_num=data.get("sequence_num"),
        )


class InMemoryBroker:
    """Thread-safe in-memory message broker with wildcard topic support (+ and #)."""

    def __init__(self):
        self._lock = threading.Lock()
        self._subscribers: list[tuple[str, Callable[[str, bytes], None]]] = []

    def subscribe(self, pattern: str, callback: Callable[[str, bytes], None]) -> None:
        with self._lock:
            self._subscribers.append((pattern, callback))

    def publish(self, topic: str, payload: bytes | str) -> int:
        data = payload.encode("utf-8") if isinstance(payload, str) else payload
        delivered = 0
        with self._lock:
            subs = list(self._subscribers)

        for pattern, callback in subs:
            if self._match_topic(pattern, topic):
                try:
                    callback(topic, data)
                    delivered += 1
                except Exception as exc:
                    logger.error(f"Error in subscriber callback for {topic}: {exc}")
        return delivered

    @staticmethod
    def _match_topic(pattern: str, topic: str) -> bool:
        # MQTT wildcards: '+' matches single level, '#' matches multiple levels
        fn_pattern = pattern.replace("+", "[^/]+").replace("#", ".*")
        return bool(re.match(f"^{fn_pattern}$", topic))
