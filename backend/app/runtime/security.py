"""Security foundation: Authentication, RBAC, and hash-chained Audit Logging.

Roles:
- VIEWER: Read-only access to digital twin state, telemetry, and alerts.
- STATION_OPERATOR: Station-level operations, alert acknowledgement for assigned station.
- HQ_MOES: Ministry / NCPOR headquarters: multi-station access, alert acknowledgement, audit review.
- SYSTEM_ADMIN: Runtime lifecycle, fault injection, system configuration.
"""

import base64
import hashlib
import hmac
import json
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.timeutil import utcnow
from app.db.session import get_db
from app.domain.runtime_enums import AuditOutcome, Permission, Role
from app.models.runtime import AuditEvent

# Permission mapping per role
ROLE_PERMISSIONS: dict[Role, set[Permission]] = {
    Role.VIEWER: {
        Permission.TWIN_READ,
        Permission.TELEMETRY_READ,
        Permission.ALERTS_READ,
        Permission.RUNTIME_READ,
    },
    Role.STATION_OPERATOR: {
        Permission.TWIN_READ,
        Permission.TELEMETRY_READ,
        Permission.ALERTS_READ,
        Permission.ALERTS_ACKNOWLEDGE,
        Permission.TELEMETRY_INGEST,
        Permission.RUNTIME_READ,
    },
    Role.HQ_MOES: {
        Permission.TWIN_READ,
        Permission.TELEMETRY_READ,
        Permission.ALERTS_READ,
        Permission.ALERTS_ACKNOWLEDGE,
        Permission.TELEMETRY_INGEST,
        Permission.RUNTIME_READ,
        Permission.AUDIT_READ,
    },
    Role.SYSTEM_ADMIN: {
        Permission.TWIN_READ,
        Permission.TELEMETRY_READ,
        Permission.ALERTS_READ,
        Permission.ALERTS_ACKNOWLEDGE,
        Permission.TELEMETRY_INGEST,
        Permission.RUNTIME_READ,
        Permission.RUNTIME_CONTROL,
        Permission.PERTURBATION_APPLY,
        Permission.AUDIT_READ,
    },
}


class AuthenticatedUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    roles: list[Role] = Field(default_factory=lambda: [Role.VIEWER])
    station_ids: list[str] = Field(default_factory=list, description="Assigned stations (empty = all stations permitted)")
    is_authenticated: bool = True

    def has_permission(self, permission: Permission, station_id: str | None = None) -> bool:
        # Check permissions granted by any of user's roles
        user_perms: set[Permission] = set()
        for r in self.roles:
            user_perms.update(ROLE_PERMISSIONS.get(r, set()))

        if permission not in user_perms:
            return False

        # If user is restricted to specific stations, check station boundary
        if station_id and self.station_ids and Role.HQ_MOES not in self.roles and Role.SYSTEM_ADMIN not in self.roles:
            if station_id.lower() not in [s.lower() for s in self.station_ids]:
                return False

        return True


# Anonymous default for unauthenticated public reads
ANONYMOUS_USER = AuthenticatedUser(
    user_id="anonymous",
    roles=[Role.VIEWER],
    station_ids=[],
    is_authenticated=False,
)


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode((s + pad).encode("utf-8"))


def create_token(
    user_id: str,
    roles: list[Role],
    station_ids: list[str] | None = None,
    secret: str | None = None,
    ttl_seconds: int = 28800,
) -> str:
    """Create a tamper-evident HS256 bearer token."""
    settings = get_settings()
    key = (secret or settings.auth_secret.get_secret_value()).encode("utf-8")
    now_ts = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": user_id,
        "roles": [r.value for r in roles],
        "stations": station_ids or [],
        "iat": now_ts,
        "exp": now_ts + ttl_seconds,
        "iss": settings.auth_issuer,
        "aud": settings.auth_audience,
    }
    seg1 = _b64encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    seg2 = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{seg1}.{seg2}".encode("utf-8")
    signature = _b64encode(hmac.new(key, signing_input, hashlib.sha256).digest())
    return f"{seg1}.{seg2}.{signature}"


def verify_token(token: str, secret: str | None = None) -> AuthenticatedUser:
    """Verify and parse a bearer token."""
    settings = get_settings()
    key = (secret or settings.auth_secret.get_secret_value()).encode("utf-8")
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed token format")

    seg1, seg2, sig_b64 = parts
    signing_input = f"{seg1}.{seg2}".encode("utf-8")
    expected_sig = hmac.new(key, signing_input, hashlib.sha256).digest()
    actual_sig = _b64decode(sig_b64)
    if not hmac.compare_digest(expected_sig, actual_sig):
        raise ValueError("Invalid token signature")

    payload = json.loads(_b64decode(seg2).decode("utf-8"))
    if int(time.time()) > payload.get("exp", 0):
        raise ValueError("Token has expired")

    roles = [Role(r) for r in payload.get("roles", ["VIEWER"]) if r in Role.__members__]
    return AuthenticatedUser(
        user_id=payload["sub"],
        roles=roles,
        station_ids=payload.get("stations", []),
        is_authenticated=True,
    )


def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(get_settings),
) -> AuthenticatedUser:
    """FastAPI dependency to extract and authenticate user."""
    if not authorization:
        if settings.auth_public_reads:
            return ANONYMOUS_USER
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization scheme must be Bearer",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization[7:].strip()
    try:
        return verify_token(token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Authentication failed: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        )


def require_permission(permission: Permission):
    """Enforce RBAC permission check on a route."""
    def _dependency(
        request: Request,
        user: AuthenticatedUser = Depends(get_current_user),
    ) -> AuthenticatedUser:
        station_id = request.path_params.get("station_id")
        if not user.has_permission(permission, station_id=station_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Forbidden: role {[r.value for r in user.roles]} lacks permission '{permission.value}'"
                + (f" for station '{station_id}'" if station_id else ""),
            )
        return user

    return _dependency


class AuditLogger:
    """Tamper-evident audit trail manager with cryptographic hash chaining."""

    def __init__(self, session: Session):
        self.session = session

    def log(
        self,
        actor: AuthenticatedUser | str,
        action: str,
        resource_type: str,
        resource_id: str | None = None,
        station_id: str | None = None,
        outcome: AuditOutcome = AuditOutcome.SUCCESS,
        request_id: str | None = None,
        client_ip: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> AuditEvent:
        actor_id = actor.user_id if isinstance(actor, AuthenticatedUser) else str(actor)
        actor_roles = ",".join(r.value for r in actor.roles) if isinstance(actor, AuthenticatedUser) else "UNKNOWN"
        now = utcnow()

        # Get latest previous event hash
        latest_event = self.session.execute(
            select(AuditEvent).order_by(AuditEvent.id.desc()).limit(1)
        ).scalar_one_or_none()
        prev_hash = latest_event.hash if latest_event else "0" * 64

        # Compute hash
        hash_payload = json.dumps(
            {
                "prev_hash": prev_hash,
                "occurred_at": now.isoformat(),
                "actor_id": actor_id,
                "action": action,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "station_id": station_id,
                "outcome": outcome.value,
                "details": details or {},
            },
            sort_keys=True,
            default=str,
        )
        curr_hash = hashlib.sha256(hash_payload.encode("utf-8")).hexdigest()

        event = AuditEvent(
            occurred_at=now,
            actor_id=actor_id,
            actor_roles=actor_roles,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            station_id=station_id,
            outcome=outcome,
            request_id=request_id,
            client_ip=client_ip,
            details=details,
            prev_hash=prev_hash,
            hash=curr_hash,
        )
        self.session.add(event)
        self.session.flush()
        return event

    def verify_chain(self) -> bool:
        """Verifies integrity of the entire audit hash chain."""
        events = self.session.scalars(select(AuditEvent).order_by(AuditEvent.id.asc())).all()
        if not events:
            return True

        expected_prev = "0" * 64
        for ev in events:
            if ev.prev_hash != expected_prev:
                return False
            payload = json.dumps(
                {
                    "prev_hash": ev.prev_hash,
                    "occurred_at": ev.occurred_at.isoformat(),
                    "actor_id": ev.actor_id,
                    "action": ev.action,
                    "resource_type": ev.resource_type,
                    "resource_id": ev.resource_id,
                    "station_id": ev.station_id,
                    "outcome": ev.outcome.value,
                    "details": ev.details or {},
                },
                sort_keys=True,
                default=str,
            )
            calc_hash = hashlib.sha256(payload.encode("utf-8")).hexdigest()
            if calc_hash != ev.hash:
                return False
            expected_prev = ev.hash
        return True
