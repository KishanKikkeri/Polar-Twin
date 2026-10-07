"""Structured logging with request correlation.

Every log line is a single JSON object (``POLARTWIN_LOG_JSON=true``, default)
carrying ``ts``, ``level``, ``logger``, ``msg``, the current ``request_id``
(when inside an HTTP request) and any ``extra={...}`` fields passed by the
caller. Secrets must never be logged; callers pass identifiers, not tokens.
"""

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

request_id_var: ContextVar[str | None] = ContextVar("polartwin_request_id", default=None)

# Attributes present on every LogRecord; anything else came from ``extra=``.
_RESERVED = set(
    vars(logging.LogRecord("x", logging.INFO, "x", 0, "x", None, None)).keys()
) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        rid = request_id_var.get()
        if rid:
            payload["request_id"] = rid
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exc_type"] = record.exc_info[0].__name__ if record.exc_info[0] else None
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


class TextFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        extras = {k: v for k, v in record.__dict__.items() if k not in _RESERVED and not k.startswith("_")}
        rid = request_id_var.get()
        if rid:
            extras["request_id"] = rid
        return f"{base} {extras}" if extras else base


_configured = False


def configure_logging(level: str = "INFO", json_logs: bool = True) -> None:
    """Idempotently configure the ``polartwin`` logger hierarchy."""
    global _configured
    root = logging.getLogger("polartwin")
    root.setLevel(level.upper())
    if _configured:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        JsonFormatter() if json_logs else TextFormatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    )
    root.addHandler(handler)
    root.propagate = False
    _configured = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name if name.startswith("polartwin") else f"polartwin.{name}")
