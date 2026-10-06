import { describeAssetStatus } from '../../services/twin/assetMapping.js'
import { formatValue } from '../../services/twin/formatters.js'
import { Chip } from '../ui/DataBadges.jsx'

// Backend assets linked to the selected 3D object.
//   status: 'loading' | 'unavailable' | 'ok'
// Assets carry no provenance field in the v1 contract, so none is claimed.
export default function AssetInspector({ status, assets = [], error, retained }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-ice-300/60">Assets (backend)</div>
        {retained && <Chip tone="warn" title="Backend unreachable; last assets received are shown">RETAINED</Chip>}
      </div>

      {status === 'loading' && <div className="text-[11px] text-ice-300/60">Loading assets…</div>}

      {status === 'unavailable' && (
        <div className="text-[11px] text-status-warn leading-snug">
          ASSETS UNAVAILABLE — could not load from the backend{error ? ` (${error.kind}${error.status ? ` ${error.status}` : ''})` : ''}. No asset data is being substituted.
        </div>
      )}

      {status === 'ok' && assets.length === 0 && (
        <div className="text-[11px] text-ice-300/50">No backend assets are linked to this object.</div>
      )}

      {status === 'ok' &&
        assets.map((a) => {
          const s = describeAssetStatus(a.status)
          return (
            <div key={a.asset_id} className="rounded-md border border-white/10 px-2.5 py-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-ice-100 font-medium">{a.name}</span>
                <Chip tone={s.tone}>{s.label}</Chip>
              </div>
              <div className="flex justify-between text-[11px] text-ice-300/60"><span>Type</span><span className="text-ice-100">{formatValue(a.asset_type)}</span></div>
              <div className="flex justify-between text-[11px] text-ice-300/60">
                <span>Health</span>
                <span className="text-ice-100" title={a.health == null ? 'Health unavailable' : undefined}>{formatValue(a.health)}</span>
              </div>
              <div className="flex justify-between text-[11px] text-ice-300/60"><span>Criticality</span><span className="text-ice-100">{formatValue(a.criticality)}</span></div>
            </div>
          )
        })}

      {status === 'ok' && assets.length > 0 && (
        <div className="text-[10px] text-ice-300/40">Provenance of asset status is not stated by the backend.</div>
      )}
    </div>
  )
}
