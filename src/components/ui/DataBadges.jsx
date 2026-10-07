// Shared provenance / freshness / connection indicators. Every operational
// value shown in the app is paired with one of these so simulated data is
// never mistaken for a real observation.

// Complete class strings (Tailwind can't see dynamically-built names).
const TONE = {
  real: 'text-status-normal border-status-normal/40 bg-status-normal/10',
  normal: 'text-status-normal border-status-normal/40 bg-status-normal/10',
  simulated: 'text-status-warn border-status-warn/40 bg-status-warn/10',
  warn: 'text-status-warn border-status-warn/40 bg-status-warn/10',
  critical: 'text-status-critical border-status-critical/40 bg-status-critical/10',
  derived: 'text-ice-accent border-ice-accent/40 bg-ice-accent/10',
  unknown: 'text-ice-300 border-white/20 bg-white/5',
}

const DOT = {
  real: 'bg-status-normal',
  normal: 'bg-status-normal',
  simulated: 'bg-status-warn',
  warn: 'bg-status-warn',
  critical: 'bg-status-critical',
  derived: 'bg-ice-accent',
  unknown: 'bg-ice-300',
}

export const toneText = (tone) => (TONE[tone] || TONE.unknown).split(' ')[0]
export const toneDot = (tone) => DOT[tone] || DOT.unknown

export function Chip({ tone = 'unknown', children, title, className = '' }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide leading-none whitespace-nowrap ${TONE[tone] || TONE.unknown} ${className}`}
    >
      {children}
    </span>
  )
}

/** `provenance` = describeProvenance() result. */
export function ProvenanceChip({ provenance, className }) {
  if (!provenance) return null
  return (
    <Chip tone={provenance.tone} title={provenance.note} className={className}>
      {provenance.label}
    </Chip>
  )
}

const FRESH_TONE = { current: 'normal', stale: 'warn', missing: 'warn', unknown: 'unknown' }

/** `freshness` = assessFreshness() result. */
export function FreshnessChip({ freshness, className }) {
  if (!freshness) return null
  return (
    <Chip tone={FRESH_TONE[freshness.state] || 'unknown'} title={`Freshness: ${freshness.reason}`} className={className}>
      {freshness.label}
    </Chip>
  )
}

/** `connection` = describeConnection() result. */
export function ConnectionDot({ connection, className = '' }) {
  const blink = connection.state === 'connected' || connection.state === 'loading' ? 'blink-dot' : ''
  return <span className={`inline-block w-2 h-2 rounded-full ${toneDot(connection.tone)} ${blink} ${className}`} />
}

/** Prominent banner for panels that render local (not backend) simulated values. */
export function SimulatedBanner({ connection }) {
  const isLoading = connection?.state === 'loading'
  const isConnected = connection?.state === 'connected'

  const title = isLoading
    ? '● CONNECTING TO BACKEND — PLEASE WAIT'
    : '● SIMULATED DATA — NOT LIVE TELEMETRY'

  const detail = isConnected
    ? 'Detail figures below come from the local demo simulator. The backend overview does not yet supply per-system data.'
    : isLoading
    ? 'Establishing connection to POLARTWIN backend... Awaiting station telemetry and overview.'
    : 'Backend unavailable. All figures below come from the local demo simulator.'

  return (
    <div className={`rounded-lg border px-3 py-2 ${isLoading ? 'border-ice-accent/40 bg-ice-accent/10' : 'border-status-warn/40 bg-status-warn/10'}`}>
      <div className={`text-[11px] font-semibold tracking-wide ${isLoading ? 'text-ice-accent animate-pulse' : 'text-status-warn'}`}>{title}</div>
      <div className="text-[11px] text-ice-300/70 mt-0.5 leading-snug">{detail}</div>
    </div>
  )
}
