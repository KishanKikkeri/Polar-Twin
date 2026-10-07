"""Explicit dependency graph and state propagation.

A ``DependencyGraph`` is a DAG of ``Node`` definitions. Each node declares its
inputs and (optionally) a pure ``relation``. Relationships live here and in
``app.runtime.causal_model`` — never in UI code.

Evaluation rules (contract §3):

* Nodes evaluate in a deterministic topological order (domain order, then id).
* ``observation_policy`` decides between a supplied observation and the
  relation:
    - ``prefer_observed`` (sensors): use the observation when present, else compute.
    - ``prefer_computed`` (roll-ups): compute when all inputs are available, else
      fall back to the observation.
* A node whose inputs are unavailable is ``UNKNOWN`` with ``value=None`` and an
  explicit reason. Unknown propagates downstream. Nothing is coerced to zero.
"""

import math
from collections import defaultdict, deque
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from app.domain.runtime_enums import NodeSource, TwinDomain
from app.runtime.determinism import stable_hash

ObservationPolicy = Literal["prefer_observed", "prefer_computed"]
Relation = Callable[[Mapping[str, float]], float]

_DOMAIN_ORDER = {d: i for i, d in enumerate(TwinDomain)}


class DependencyGraphError(ValueError):
    pass


@dataclass(frozen=True)
class Node:
    id: str
    domain: TwinDomain
    unit: str
    description: str
    inputs: tuple[str, ...] = ()
    relation: Relation | None = field(default=None, compare=False, repr=False)
    formula: str = ""
    channel_id: str | None = None
    observation_policy: ObservationPolicy = "prefer_observed"
    lower: float | None = None
    upper: float | None = None

    @property
    def exogenous(self) -> bool:
        return self.relation is None


@dataclass(frozen=True)
class NodeResult:
    node_id: str
    domain: TwinDomain
    unit: str
    value: float | None
    source: NodeSource
    inputs: dict[str, float | None]
    reason: str | None = None
    channel_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "node_id": self.node_id,
            "domain": self.domain.value,
            "unit": self.unit,
            "value": self.value,
            "source": self.source.value,
            "inputs": self.inputs,
            "reason": self.reason,
            "channel_id": self.channel_id,
        }


@dataclass(frozen=True)
class DependencyEvaluation:
    graph_id: str
    model_version: str
    graph_hash: str
    order: tuple[str, ...]
    results: dict[str, NodeResult]

    def value(self, node_id: str) -> float | None:
        return self.results[node_id].value

    def values(self) -> dict[str, float | None]:
        return {k: r.value for k, r in self.results.items()}

    @property
    def unknown_nodes(self) -> list[str]:
        return [k for k in self.order if self.results[k].source in (NodeSource.UNKNOWN, NodeSource.MISSING)]

    def result_hash(self) -> str:
        return stable_hash({k: (r.value, r.source.value) for k, r in self.results.items()})

    def to_dict(self) -> dict[str, Any]:
        return {
            "graph_id": self.graph_id,
            "model_version": self.model_version,
            "graph_hash": self.graph_hash,
            "result_hash": self.result_hash(),
            "order": list(self.order),
            "unknown_nodes": self.unknown_nodes,
            "nodes": [self.results[k].to_dict() for k in self.order],
        }


@dataclass(frozen=True)
class ImpactRow:
    node_id: str
    domain: TwinDomain
    unit: str
    baseline: float | None
    perturbed: float | None
    delta: float | None
    pct_change: float | None
    path: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "node_id": self.node_id,
            "domain": self.domain.value,
            "unit": self.unit,
            "baseline": self.baseline,
            "perturbed": self.perturbed,
            "delta": self.delta,
            "pct_change": self.pct_change,
            "path": list(self.path),
        }


@dataclass(frozen=True)
class ImpactResult:
    perturbation: dict[str, float]
    rows: tuple[ImpactRow, ...]
    baseline: DependencyEvaluation
    perturbed: DependencyEvaluation

    def row(self, node_id: str) -> ImpactRow:
        for r in self.rows:
            if r.node_id == node_id:
                return r
        raise KeyError(node_id)

    def to_dict(self) -> dict[str, Any]:
        return {"perturbation": self.perturbation, "rows": [r.to_dict() for r in self.rows]}


def _round(v: float | None, nd: int = 6) -> float | None:
    return None if v is None else round(v, nd)


class DependencyGraph:
    def __init__(self, graph_id: str, model_version: str, nodes: Iterable[Node]):
        self.graph_id = graph_id
        self.model_version = model_version
        self.nodes: dict[str, Node] = {}
        for n in nodes:
            if n.id in self.nodes:
                raise DependencyGraphError(f"duplicate node id {n.id!r}")
            self.nodes[n.id] = n
        for n in self.nodes.values():
            for i in n.inputs:
                if i not in self.nodes:
                    raise DependencyGraphError(f"node {n.id!r} depends on unknown node {i!r}")
            if n.relation is None and n.inputs:
                raise DependencyGraphError(f"exogenous node {n.id!r} cannot declare inputs")
        self.children: dict[str, list[str]] = defaultdict(list)
        for n in self.nodes.values():
            for i in n.inputs:
                self.children[i].append(n.id)
        self.order: tuple[str, ...] = self._toposort()
        self.graph_hash = stable_hash(
            {
                "id": graph_id,
                "version": model_version,
                "nodes": [(n.id, n.domain.value, n.unit, n.inputs, n.formula, n.observation_policy) for n in self.nodes.values()],
            }
        )

    # ---- structure ---------------------------------------------------------

    def _sort_key(self, node_id: str) -> tuple[int, str]:
        return (_DOMAIN_ORDER[self.nodes[node_id].domain], node_id)

    def _toposort(self) -> tuple[str, ...]:
        indeg = {k: len(n.inputs) for k, n in self.nodes.items()}
        ready = sorted((k for k, d in indeg.items() if d == 0), key=self._sort_key)
        out: list[str] = []
        while ready:
            k = ready.pop(0)
            out.append(k)
            for c in self.children.get(k, ()):
                indeg[c] -= 1
                if indeg[c] == 0:
                    ready.append(c)
            ready.sort(key=self._sort_key)
        if len(out) != len(self.nodes):
            cyclic = sorted(k for k, d in indeg.items() if d > 0)
            raise DependencyGraphError(f"dependency cycle among: {cyclic}")
        return tuple(out)

    def downstream(self, node_ids: Iterable[str]) -> set[str]:
        seen: set[str] = set()
        queue = deque(node_ids)
        while queue:
            k = queue.popleft()
            for c in self.children.get(k, ()):
                if c not in seen:
                    seen.add(c)
                    queue.append(c)
        return seen

    def upstream(self, node_id: str) -> set[str]:
        seen: set[str] = set()
        queue = deque(self.nodes[node_id].inputs)
        while queue:
            k = queue.popleft()
            if k not in seen:
                seen.add(k)
                queue.extend(self.nodes[k].inputs)
        return seen

    def path(self, source: str, target: str) -> tuple[str, ...]:
        """Shortest causal path source → target (BFS, deterministic tie-break)."""
        prev: dict[str, str | None] = {source: None}
        queue = deque([source])
        while queue:
            k = queue.popleft()
            if k == target:
                break
            for c in sorted(self.children.get(k, ()), key=self._sort_key):
                if c not in prev:
                    prev[c] = k
                    queue.append(c)
        if target not in prev:
            return ()
        out = [target]
        while prev[out[-1]] is not None:
            out.append(prev[out[-1]])  # type: ignore[arg-type]
        return tuple(reversed(out))

    def describe(self) -> dict[str, Any]:
        return {
            "graph_id": self.graph_id,
            "model_version": self.model_version,
            "graph_hash": self.graph_hash,
            "domains": [d.value for d in TwinDomain],
            "order": list(self.order),
            "nodes": [
                {
                    "id": n.id,
                    "domain": n.domain.value,
                    "unit": n.unit,
                    "description": n.description,
                    "inputs": list(n.inputs),
                    "formula": n.formula,
                    "exogenous": n.exogenous,
                    "channel_id": n.channel_id,
                    "observation_policy": n.observation_policy,
                }
                for n in (self.nodes[k] for k in self.order)
            ],
            "edges": [{"from": i, "to": n.id} for n in (self.nodes[k] for k in self.order) for i in n.inputs],
        }

    # ---- evaluation --------------------------------------------------------

    def evaluate(
        self,
        observations: Mapping[str, float | None],
        *,
        force_compute: Iterable[str] = (),
    ) -> DependencyEvaluation:
        unknown_obs = set(observations) - set(self.nodes)
        if unknown_obs:
            raise DependencyGraphError(f"observations for unknown nodes: {sorted(unknown_obs)}")
        forced = set(force_compute)
        values: dict[str, float | None] = {}
        results: dict[str, NodeResult] = {}
        for k in self.order:
            n = self.nodes[k]
            obs = observations.get(k)
            if obs is not None and not math.isfinite(obs):
                obs = None
            inputs = {i: values[i] for i in n.inputs}
            missing = sorted(i for i, v in inputs.items() if v is None)

            use_obs = obs is not None and k not in forced and (
                n.relation is None or n.observation_policy == "prefer_observed" or missing
            )
            if use_obs:
                res = NodeResult(k, n.domain, n.unit, obs, NodeSource.OBSERVED, inputs, None, n.channel_id)
            elif n.relation is None:
                res = NodeResult(k, n.domain, n.unit, None, NodeSource.MISSING, inputs,
                                 "exogenous input not observed", n.channel_id)
            elif missing:
                res = NodeResult(k, n.domain, n.unit, None, NodeSource.UNKNOWN, inputs,
                                 f"missing input: {', '.join(missing)}", n.channel_id)
            else:
                try:
                    v = float(n.relation(inputs))  # type: ignore[arg-type]
                except (ZeroDivisionError, ValueError, OverflowError) as exc:
                    res = NodeResult(k, n.domain, n.unit, None, NodeSource.UNKNOWN, inputs,
                                     f"relation undefined: {type(exc).__name__}", n.channel_id)
                else:
                    if not math.isfinite(v):
                        res = NodeResult(k, n.domain, n.unit, None, NodeSource.UNKNOWN, inputs,
                                         "relation produced a non-finite value", n.channel_id)
                    else:
                        if n.lower is not None:
                            v = max(n.lower, v)
                        if n.upper is not None:
                            v = min(n.upper, v)
                        res = NodeResult(k, n.domain, n.unit, _round(v), NodeSource.COMPUTED, inputs, None, n.channel_id)
            values[k] = res.value
            results[k] = res
        return DependencyEvaluation(self.graph_id, self.model_version, self.graph_hash, self.order, results)

    def impact(self, observations: Mapping[str, float | None], perturbation: Mapping[str, float]) -> ImpactResult:
        """Propagate a change through the graph.

        Upstream/unaffected nodes are pinned to their current evaluated values;
        every node downstream of the perturbed nodes is *recomputed* by its
        relation (in both baseline and perturbed runs) so the delta reflects the
        model's causal response, not sensor noise.
        """
        for k in perturbation:
            if k not in self.nodes:
                raise DependencyGraphError(f"cannot perturb unknown node {k!r}")
        current = self.evaluate(observations)
        affected = self.downstream(perturbation)
        pinned = {k: v for k, v in current.values().items() if k not in affected}
        baseline = self.evaluate(pinned, force_compute=affected)
        perturbed_obs = dict(pinned)
        perturbed_obs.update(perturbation)
        perturbed = self.evaluate(perturbed_obs, force_compute=affected - set(perturbation))

        rows: list[ImpactRow] = []
        for k in self.order:
            if k not in affected and k not in perturbation:
                continue
            b, p = baseline.value(k), perturbed.value(k)
            if k in perturbation:
                b = current.value(k)
            delta = None if (b is None or p is None) else _round(p - b)
            pct = None if (delta is None or not b) else _round(100.0 * delta / abs(b), 3)
            src = next((s for s in perturbation if k == s or k in self.downstream([s])), None)
            rows.append(ImpactRow(k, self.nodes[k].domain, self.nodes[k].unit, b, p, delta, pct,
                                  self.path(src, k) if src else ()))
        return ImpactResult(dict(perturbation), tuple(rows), baseline, perturbed)
