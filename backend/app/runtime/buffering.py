"""Store-and-forward buffer for edge-to-cloud resilience.

Antarctic research stations communicate over geostationary satcom links
subject to polar ionospheric scintillation, blizzards, and scheduled outages.

This module provides:
1. `EdgeBuffer`: bounded FIFO buffer with durable overflow protection.
2. `ResilientPublisher`: handles link disconnection, buffering, and
   batched store-and-forward flushing upon reconnection.
"""

import json
import sqlite3
import threading
from collections import deque
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import Any

from app.core.logging import get_logger
from app.core.timeutil import utcnow
from app.runtime.telemetry_event import TelemetryEvent

logger = get_logger("polartwin.buffer")


class EdgeBuffer:
    """Bounded store-and-forward queue with optional SQLite backing."""

    def __init__(self, capacity: int = 50_000, db_path: str | None = None):
        self.capacity = capacity
        self.db_path = db_path
        self._lock = threading.Lock()
        self._memory_queue: deque[TelemetryEvent] = deque(maxlen=capacity) if db_path is None else None  # type: ignore
        self.dropped_count = 0

        if self.db_path:
            self._init_sqlite()

    def _init_sqlite(self) -> None:
        with sqlite3.connect(self.db_path) as conn:  # type: ignore[arg-type]
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS buffered_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT UNIQUE,
                    payload TEXT NOT NULL,
                    enqueued_at TEXT NOT NULL
                )
                """
            )
            conn.commit()

    def push(self, event: TelemetryEvent) -> bool:
        """Enqueue an event. If capacity is full, drops oldest and returns False."""
        with self._lock:
            if self.db_path:
                with sqlite3.connect(self.db_path) as conn:
                    count = conn.execute("SELECT count(*) FROM buffered_events").fetchone()[0]
                    if count >= self.capacity:
                        # Drop oldest
                        conn.execute("DELETE FROM buffered_events WHERE id IN (SELECT id FROM buffered_events ORDER BY id ASC LIMIT 1)")
                        self.dropped_count += 1
                    conn.execute(
                        "INSERT OR IGNORE INTO buffered_events (event_id, payload, enqueued_at) VALUES (?, ?, ?)",
                        (event.event_id, event.model_dump_json(), utcnow().isoformat()),
                    )
                    conn.commit()
                return True
            else:
                if len(self._memory_queue) >= self.capacity:
                    self._memory_queue.popleft()
                    self.dropped_count += 1
                self._memory_queue.append(event)
                return True

    def drain(self, max_items: int = 500) -> list[TelemetryEvent]:
        """Drain up to `max_items` events in FIFO order."""
        with self._lock:
            events: list[TelemetryEvent] = []
            if self.db_path:
                with sqlite3.connect(self.db_path) as conn:
                    rows = conn.execute(
                        "SELECT id, payload FROM buffered_events ORDER BY id ASC LIMIT ?", (max_items,)
                    ).fetchall()
                    ids_to_del = []
                    for row_id, payload_str in rows:
                        events.append(TelemetryEvent.model_validate_json(payload_str))
                        ids_to_del.append(row_id)
                    if ids_to_del:
                        conn.execute(f"DELETE FROM buffered_events WHERE id IN ({','.join(['?']*len(ids_to_del))})", ids_to_del)
                        conn.commit()
            else:
                for _ in range(min(max_items, len(self._memory_queue))):
                    events.append(self._memory_queue.popleft())
            return events

    def size(self) -> int:
        with self._lock:
            if self.db_path:
                with sqlite3.connect(self.db_path) as conn:
                    return conn.execute("SELECT count(*) FROM buffered_events").fetchone()[0]
            return len(self._memory_queue)

    def is_empty(self) -> bool:
        return self.size() == 0


class ResilientPublisher:
    """Manages connection state and automatic store-and-forward flushing."""

    def __init__(
        self,
        sink: Callable[[Sequence[TelemetryEvent]], Any],
        buffer: EdgeBuffer | None = None,
        is_connected: bool = True,
    ):
        self.sink = sink
        self.buffer = buffer or EdgeBuffer(capacity=10_000)
        self.is_connected = is_connected
        self._lock = threading.Lock()

    def set_connected(self, connected: bool) -> int:
        """Switch link state. If reconnecting (False -> True), flushes buffer."""
        flushed = 0
        with self._lock:
            was_down = not self.is_connected
            self.is_connected = connected
            if was_down and connected:
                flushed = self.flush()
        return flushed

    def publish(self, event: TelemetryEvent) -> bool:
        """Publishes immediately if connected; buffers if link is disconnected."""
        with self._lock:
            if not self.is_connected:
                self.buffer.push(event)
                return False
            try:
                self.sink([event])
                return True
            except Exception as exc:
                logger.warning(f"Publish failed: {exc}. Enqueuing to edge buffer.")
                self.is_connected = False
                self.buffer.push(event)
                return False

    def flush(self, batch_size: int = 500) -> int:
        """Flush all pending items from buffer to sink in batches."""
        total_flushed = 0
        while not self.buffer.is_empty() and self.is_connected:
            batch = self.buffer.drain(batch_size)
            if not batch:
                break
            try:
                self.sink(batch)
                total_flushed += len(batch)
            except Exception as exc:
                logger.error(f"Flush failed: {exc}. Re-buffering and marking link down.")
                for ev in reversed(batch):
                    self.buffer.push(ev)
                self.is_connected = False
                break
        return total_flushed
