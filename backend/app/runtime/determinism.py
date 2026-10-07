"""Deterministic pseudo-randomness and stable hashing.

The simulator never touches ``random`` or the wall clock. Every stochastic
term is a pure function of ``(seed, *keys)`` via BLAKE2b, so the same initial
state + perturbations + model version + seed reproduce bit-identical output,
regardless of call order, process, or platform.
"""

import hashlib
import json
import math
import struct
from typing import Any


def _digest(seed: int, keys: tuple[Any, ...]) -> bytes:
    h = hashlib.blake2b(digest_size=16)
    h.update(str(seed).encode())
    for k in keys:
        h.update(b"\x1f")
        h.update(str(k).encode())
    return h.digest()


def uniform(seed: int, *keys: Any) -> float:
    """Deterministic U[0,1)."""
    (n,) = struct.unpack(">Q", _digest(seed, keys)[:8])
    return n / 2**64


def normal(seed: int, *keys: Any) -> float:
    """Deterministic N(0,1) via Box-Muller on two derived uniforms."""
    u1 = max(uniform(seed, *keys, "bm1"), 1e-12)
    u2 = uniform(seed, *keys, "bm2")
    return math.sqrt(-2.0 * math.log(u1)) * math.cos(2 * math.pi * u2)


def phase(seed: int, *keys: Any) -> float:
    """Deterministic phase in [0, 2π)."""
    return 2 * math.pi * uniform(seed, *keys, "phase")


def stable_hash(obj: Any, length: int = 16) -> str:
    """Hex digest of a JSON-canonicalised object (sorted keys, floats rounded to 9 dp)."""

    def _canon(o: Any) -> Any:
        if isinstance(o, float):
            return round(o, 9) if math.isfinite(o) else str(o)
        if isinstance(o, dict):
            return {str(k): _canon(v) for k, v in sorted(o.items(), key=lambda kv: str(kv[0]))}
        if isinstance(o, (list, tuple)):
            return [_canon(v) for v in o]
        return o

    payload = json.dumps(_canon(obj), sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode()).hexdigest()[:length]
