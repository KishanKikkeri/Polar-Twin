"""Request correlation + access logging + HTTP metrics middleware (pure ASGI)."""

import re
import time
import uuid

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.logging import get_logger, request_id_var
from app.observability.metrics import REGISTRY, MetricsRegistry

logger = get_logger("polartwin.http")
_SAFE_RID = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")


class RequestContextMiddleware:
    """Assigns/propagates ``X-Request-ID``, logs one structured access line, records latency."""

    def __init__(self, app: ASGIApp, registry: MetricsRegistry = REGISTRY):
        self.app = app
        self.requests = registry.counter("polartwin_http_requests_total", "HTTP requests by route and status")
        self.latency = registry.histogram("polartwin_http_request_seconds", "HTTP request latency")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = dict(scope.get("headers") or []).get(b"x-request-id", b"").decode("latin-1")
        rid = incoming if _SAFE_RID.match(incoming or "") else uuid.uuid4().hex
        token = request_id_var.set(rid)
        scope.setdefault("state", {})["request_id"] = rid
        start = time.perf_counter()
        status_holder = {"status": 500}

        async def _send(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", rid.encode()))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, _send)
        finally:
            elapsed = time.perf_counter() - start
            route = scope.get("route")
            path_tpl = getattr(route, "path", None) or "unmatched"
            status = status_holder["status"]
            self.requests.inc(method=scope["method"], route=path_tpl, status=str(status))
            self.latency.observe(elapsed, route=path_tpl)
            logger.info(
                "request",
                extra={
                    "method": scope["method"],
                    "path": scope["path"],
                    "route": path_tpl,
                    "status": status,
                    "duration_ms": round(elapsed * 1000, 2),
                },
            )
            request_id_var.reset(token)
