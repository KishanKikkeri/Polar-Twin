// Agent 4B — prediction persistence. A SEPARATE append-only store for model outputs; it has no API to write twin state,
// so predictions can never overwrite observed/synthetic state. Not database infrastructure: in-memory or JSON-lines file.
import fs from 'node:fs';
import { hash } from './common.js';

function makeStore(records, append) {
  return {
    save(env) {
      if (!env?.kind || !env?.stationId || !env?.provenance) throw new TypeError('prediction envelope needs kind, stationId, provenance');
      const rec = { id: `${env.kind}:${env.stationId}:${env.asOf}:${hash(env)}`, savedFor: env.generatedAt ?? env.asOf, envelope: env };
      if (!records.some((r) => r.id === rec.id)) { records.push(rec); append?.(rec); } // idempotent for identical content
      return rec.id;
    },
    latest(stationId, kind) { const l = records.filter((r) => r.envelope.stationId === stationId && r.envelope.kind === kind); return l.length ? l[l.length - 1].envelope : null; },
    list(stationId, kind, { limit = 50 } = {}) { return records.filter((r) => r.envelope.stationId === stationId && (!kind || r.envelope.kind === kind)).slice(-limit).map((r) => r.envelope); },
    count: () => records.length,
  };
}
export const createMemoryStore = () => makeStore([], null);
export function createFileStore(path) {
  const records = fs.existsSync(path) ? fs.readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return makeStore(records, (rec) => fs.appendFileSync(path, JSON.stringify(rec) + '\n'));
}
