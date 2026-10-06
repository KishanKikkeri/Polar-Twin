// Simple top-down projection of the current station's footprint into a
// small SVG, with a marker for the currently selected object.
export default function MiniMap({ selected, objects, stationName }) {
  if (!selected || !objects?.length) return null
  const xs = objects.map((o) => o.position[0])
  const zs = objects.map((o) => o.position[2])
  const minX = Math.min(...xs) - 8
  const maxX = Math.max(...xs) + 8
  const minZ = Math.min(...zs) - 8
  const maxZ = Math.max(...zs) + 8
  const w = 140
  const h = 100

  const project = (x, z) => [
    ((x - minX) / (maxX - minX)) * w,
    ((z - minZ) / (maxZ - minZ)) * h,
  ]

  return (
    <div className="absolute top-44 right-3 z-20 glass glow-border rounded-xl p-2 w-[160px]">
      <div className="text-[10px] uppercase tracking-wide text-ice-300/50 mb-1 px-1">{stationName}</div>
      <svg width={w} height={h} className="rounded-md bg-white/[0.03]">
        {objects.map((o) => {
          const [x, y] = project(o.position[0], o.position[2])
          const isSel = o.id === selected.id
          return (
            <circle
              key={o.id}
              cx={x}
              cy={y}
              r={isSel ? 4 : 2}
              fill={isSel ? '#3fd7ff' : 'rgba(159,212,234,0.4)'}
            />
          )
        })}
      </svg>
      <div className="text-[10px] text-ice-accent mt-1 px-1">● You are here — {selected.name}</div>
    </div>
  )
}
