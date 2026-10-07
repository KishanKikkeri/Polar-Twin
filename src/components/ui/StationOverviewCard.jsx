import { useEffect, useState } from 'react'
import { Chip, ConnectionDot, FreshnessChip, ProvenanceChip, toneDot, toneText } from './DataBadges.jsx'

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-3 text-[11px]">
      <span className="text-ice-300/60">{label}</span>
      <span className="text-ice-100 text-right">{children}</span>
    </div>
  )
}

// Backend twin overview. `view` is the buildTwinView() result; every state the
// brief names is handled explicitly: loading, error/unavailable, empty,
// stale, simulated, real-observation and unavailable values.
export default function StationOverviewCard({
  view,
  loading,
  error,
  defaultOpen = true,
  onOpenCopilot,
  onOpenWhatIf,
  onOpenIntelligence,
  onOpenEmergency,
}) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => setOpen(defaultOpen), [defaultOpen])

  const { connection, overview } = view
  const toggle = (
    <button onClick={() => setOpen((v) => !v)} className="text-ice-300/50 hover:text-ice-100 text-xs" aria-label={open ? 'Collapse overview' : 'Expand overview'}>
      {open ? '▾' : '▸'}
    </button>
  )

  return (
    <div className="absolute top-16 left-3 z-20 glass glow-border rounded-xl w-[270px] max-w-[80vw] max-h-[calc(100vh-9rem)] overflow-y-auto">
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
        <span className="text-[10px] uppercase tracking-wide text-ice-300/50">Twin Overview</span>
        {toggle}
      </div>

      <div className="px-3 pb-3 pt-1.5 space-y-2">
        <div className="flex items-center gap-1.5 text-[11px]">
          <ConnectionDot connection={connection} />
          <span className="text-ice-100">{connection.label}</span>
        </div>

        {open && (
          <>
            {loading && !overview && <div className="text-[11px] text-ice-300/60">Loading backend overview…</div>}

            {!loading && !overview && (
              <div className="rounded-lg border border-status-warn/30 bg-status-warn/5 px-2.5 py-2 space-y-1">
                <div className="text-[11px] font-semibold text-status-warn">BACKEND OVERVIEW UNAVAILABLE</div>
                <div className="text-[11px] text-ice-300/70 leading-snug">
                  {connection.detail} Station status is <b>unknown</b>; no operational state is being claimed.
                </div>
                {error && <div className="text-[10px] text-ice-300/40">{error.kind}{error.status ? ` ${error.status}` : ''}</div>}
              </div>
            )}

            {overview && (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <ProvenanceChip provenance={overview.provenance} />
                  <FreshnessChip freshness={overview.freshness} />
                  {overview.retained && <Chip tone="warn" title="Backend unreachable; last overview received is shown">RETAINED</Chip>}
                </div>

                {!overview.provenance.isReal && (
                  <div className="text-[10px] text-status-warn/90 leading-snug">{overview.provenance.note}</div>
                )}

                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${toneDot(view.headline.tone)}`} />
                  <span className={`text-xs font-semibold ${toneText(view.headline.tone)}`}>{view.headline.label}</span>
                </div>

                <div className="space-y-0.5 pt-1 border-t border-white/10">
                  <Row label="Last updated">{overview.lastUpdatedUtc}</Row>
                  <Row label="Age">{overview.ageLabel}</Row>
                  <Row label="Active alerts">{view.alerts.length}</Row>
                </div>

                <div className="pt-1 border-t border-white/10 space-y-0.5">
                  <div className="text-[10px] uppercase tracking-wide text-ice-300/50">Risk</div>
                  <Row label="Score">{overview.risk.scoreDisplay}{overview.risk.score === null && <span className="text-ice-300/40"> (not available)</span>}</Row>
                  <Row label="Severity"><span className={toneText(overview.risk.tone)}>{overview.risk.label}</span></Row>
                  {overview.risk.trend && <Row label="Trend">{overview.risk.trend}</Row>}
                  {overview.risk.factors.length > 0 && (
                    <div className="text-[10px] text-ice-300/60 leading-snug">Factors: {overview.risk.factors.join(', ')}</div>
                  )}
                </div>

                {overview.domains.map((d) => (
                  <div key={d.key} className="pt-1 border-t border-white/10 space-y-0.5">
                    <div className="text-[10px] uppercase tracking-wide text-ice-300/50">{d.label}</div>
                    {d.empty ? (
                      <div className="text-[11px] text-ice-300/40">No data reported</div>
                    ) : (
                      <>
                        {d.rows.map((r) => (
                          <Row key={r.key} label={r.label}>
                            <span className={r.missing ? 'text-ice-300/40' : ''} title={r.missing ? 'Value unavailable' : undefined}>{r.value}</span>
                          </Row>
                        ))}
                        {d.hiddenCount > 0 && <div className="text-[10px] text-ice-300/40">+{d.hiddenCount} more field(s) not shown</div>}
                      </>
                    )}
                  </div>
                ))}

                <div className="pt-2 border-t border-white/10 flex flex-wrap gap-1">
                  {onOpenCopilot && (
                    <button
                      onClick={onOpenCopilot}
                      className="px-2 py-1 rounded bg-cyan-500/10 hover:bg-cyan-500/25 border border-cyan-500/30 text-[10px] font-mono text-cyan-300 transition-colors flex items-center gap-1"
                      title="Open AI Copilot"
                    >
                      <span>🤖</span>
                      <span>Copilot</span>
                    </button>
                  )}
                  {onOpenWhatIf && (
                    <button
                      onClick={onOpenWhatIf}
                      className="px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/25 border border-amber-500/30 text-[10px] font-mono text-amber-300 transition-colors flex items-center gap-1"
                      title="What-If Scenario Simulator"
                    >
                      <span>⚡</span>
                      <span>What-If</span>
                    </button>
                  )}
                  {onOpenIntelligence && (
                    <button
                      onClick={onOpenIntelligence}
                      className="px-2 py-1 rounded bg-purple-500/10 hover:bg-purple-500/25 border border-purple-500/30 text-[10px] font-mono text-purple-300 transition-colors flex items-center gap-1"
                      title="4B Intelligence Models"
                    >
                      <span>🧠</span>
                      <span>Models</span>
                    </button>
                  )}
                  {onOpenEmergency && (
                    <button
                      onClick={onOpenEmergency}
                      className="px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/25 border border-red-500/30 text-[10px] font-mono text-red-300 transition-colors flex items-center gap-1"
                      title="Emergency Mode"
                    >
                      <span>🚨</span>
                      <span>Emergency</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
