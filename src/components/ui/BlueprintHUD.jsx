import { useEffect, useState } from 'react'

const CYAN = '#3fd7ff'

function CornerFrame() {
  return <div className="blueprint-frame" aria-hidden="true" />
}

function Callout({ className = '', side = 'left', title, subtitle, target }) {
  return (
    <div className={`blueprint-callout ${side} ${className}`}>
      <div className="blueprint-callout-box">
        <div className="blueprint-callout-title">{title}</div>
        {subtitle && <div className="blueprint-callout-subtitle">{subtitle}</div>}
      </div>
      <div className="blueprint-callout-line" style={{ background: `linear-gradient(${side === 'left' ? '90deg' : '270deg'}, transparent, ${CYAN})` }} />
      {target && <div className="blueprint-target" style={{ left: target.x, top: target.y }} />}
    </div>
  )
}

export default function BlueprintHUD({ stationName = 'Maitri', objectCount = 0, dataLabel = 'SIMULATED', linkLabel = 'UNKNOWN' }) {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="blueprint-hud" aria-hidden="true">
      <CornerFrame />

      <div className="blueprint-scanlines" />
      <div className="blueprint-vignette" />

      <div className="blueprint-title-panel">
        <span className="blueprint-kicker">POLAR DIGITAL TWIN // ORBITAL VIEW</span>
        <h1>{stationName.toUpperCase()} STATION — COMPLETE BLUEPRINT MODEL</h1>
        <span className="blueprint-subtitle">HOLOGRAPHIC SITE RECONSTRUCTION · MULTI-LAYER INFRASTRUCTURE MAP</span>
      </div>

      <div className="blueprint-status-top">
        <span><i /> {dataLabel}</span>
        <span>OBJECTS {String(objectCount).padStart(2, '0')}</span>
        <span>{time.toISOString().slice(0, 19).replace('T', ' ') }Z</span>
      </div>

      <div className="blueprint-compass">
        <div className="compass-ring"><b>N</b><span>E</span><b>S</b><span>W</span><i /></div>
        <div className="compass-coords">70°45′55″ S<br />11°44′09″ E</div>
      </div>

      <Callout className="callout-main" title="MAIN MODULE" subtitle="LAB / RESEARCH · ZOOM 20X" side="left" />
      <Callout className="callout-power" title="POWER MODULE" subtitle="GEN SET · ZOOM 15X" side="left" />
      <Callout className="callout-fuel" title="FUEL FARMS" subtitle="STORAGE · ZOOM 10X" side="left" />
      <Callout className="callout-water" title="WATER PURIFICATION UNIT" subtitle="ZOOM 3X" side="right" />
      <Callout className="callout-comms" title="ANTENNA ARRAY" subtitle="COMMUNICATION · ZOOM 5X" side="right" />

      <div className="blueprint-legend left-bottom">
        <div className="legend-heading">STATION OVERVIEW</div>
        <div className="legend-row"><b /> Research & monitoring facility</div>
        <div className="legend-row"><b /> Renewable energy systems</div>
        <div className="legend-row"><b /> Water purification</div>
        <div className="legend-row"><b /> Fuel storage & logistics</div>
        <div className="legend-row"><b /> Communication array</div>
      </div>

      <div className="blueprint-legend right-bottom">
        <div className="legend-heading">KEY INFRASTRUCTURE</div>
        <div className="legend-row">⚡ Power Module — Gen Set</div>
        <div className="legend-row">⌂ Main Module — Lab / Research</div>
        <div className="legend-row">▣ Fuel Farms — Storage</div>
        <div className="legend-row">▤ Water Purification Unit</div>
        <div className="legend-row">✦ Antenna — Communication</div>
      </div>

      <div className="blueprint-zoom">
        <div className="zoom-label">MULTI-LEVEL ZOOM: ACTIVE</div>
        <div className="zoom-controls"><button>-</button><div className="zoom-track"><span /></div><button>+</button></div>
      </div>

      <div className="blueprint-corner-readout">SYS / MAITRI-01<br />LAT -70.7653 · LON 11.7358<br />MODE: 3D HOLOGRAM<br />LINK: {linkLabel}</div>
    </div>
  )
}
