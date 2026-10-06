import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, Edges, Line } from '@react-three/drei'

const GLOW = '#3fd7ff'
const STILT_COLOR = '#2a5a6e'

// Holographic-blueprint styling used throughout this file: mesh bodies are
// rendered as faint translucent volumes with bright glowing wireframe edges
// (via drei's <Edges>), echoing the station's own "digital twin blueprint"
// concept art rather than solid opaque buildings.
function blueprintMaterialProps(color) {
  return {
    color,
    transparent: true,
    opacity: 0.14,
    roughness: 0.4,
    metalness: 0.1,
    emissive: color,
    emissiveIntensity: 0.22,
  }
}

// Thin glowing rectangle traced on the ground beneath a structure — the
// "foundation footprint" marks seen in the station's own blueprint concept
// art, reinforcing the hologram-over-real-site feel.
function Footprint({ w, d, y = 0.04 }) {
  const hw = w / 2
  const hd = d / 2
  const pts = [
    [-hw, y, -hd],
    [hw, y, -hd],
    [hw, y, hd],
    [-hw, y, hd],
    [-hw, y, -hd],
  ]
  return <Line points={pts} color={GLOW} lineWidth={1.1} transparent opacity={0.4} />
}

function Stilts({ w, d, h }) {
  const legs = []
  const xs = [-w / 2 + 0.4, w / 2 - 0.4]
  const zs = [-d / 2 + 0.4, d / 2 - 0.4]
  for (const x of xs) {
    for (const z of zs) {
      legs.push([x, z])
    }
  }
  return (
    <group>
      {legs.map(([x, z], i) => (
        <mesh key={i} position={[x, h / 2, z]}>
          <boxGeometry args={[0.18, h, 0.18]} />
          <meshBasicMaterial color={STILT_COLOR} transparent opacity={0.8} />
        </mesh>
      ))}
    </group>
  )
}

function Windows({ w, h, d, color = GLOW }) {
  const count = Math.max(2, Math.floor(w / 2.4))
  const items = []
  for (let i = 0; i < count; i++) {
    const x = -w / 2 + (i + 0.5) * (w / count)
    items.push(
      <mesh key={`f-${i}`} position={[x, h * 0.1, d / 2 + 0.03]}>
        <planeGeometry args={[0.8, 0.8]} />
        <meshBasicMaterial color={color} transparent opacity={0.55} />
      </mesh>
    )
    items.push(
      <mesh key={`b-${i}`} position={[x, h * 0.1, -d / 2 - 0.03]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.8, 0.8]} />
        <meshBasicMaterial color={color} transparent opacity={0.55} />
      </mesh>
    )
  }
  return <group>{items}</group>
}

function WireGridBox({ w, h, d }) {
  const lines = []
  const ySteps = Math.max(2, Math.ceil(h / 0.8))
  const xSteps = Math.max(3, Math.ceil(w / 1.8))
  const zSteps = Math.max(2, Math.ceil(d / 1.8))
  for (let i = 1; i < xSteps; i++) {
    const x = -w / 2 + (w * i) / xSteps
    lines.push({ key: `x${i}`, pts: [[x, -h/2, d/2 + .015], [x, h/2, d/2 + .015]] })
    lines.push({ key: `xb${i}`, pts: [[x, -h/2, -d/2 - .015], [x, h/2, -d/2 - .015]] })
  }
  for (let i = 1; i < ySteps; i++) {
    const y = -h / 2 + (h * i) / ySteps
    lines.push({ key: `y${i}`, pts: [[-w/2, y, d/2 + .02], [w/2, y, d/2 + .02]] })
    lines.push({ key: `yb${i}`, pts: [[-w/2, y, -d/2 - .02], [w/2, y, -d/2 - .02]] })
  }
  for (let i = 1; i < zSteps; i++) {
    const z = -d / 2 + (d * i) / zSteps
    lines.push({ key: `z${i}`, pts: [[-w/2 - .02, -h/2, z], [-w/2 - .02, h/2, z]] })
    lines.push({ key: `zr${i}`, pts: [[w/2 + .02, -h/2, z], [w/2 + .02, h/2, z]] })
  }
  return <group>
    {lines.map((line) => <Line key={line.key} points={line.pts} color={GLOW} lineWidth={0.45} transparent opacity={0.34} />)}
  </group>
}

function ElevatedBox({ size, color, stiltHeight = 1.4, children }) {
  const [w, h, d] = size
  return (
    <group>
      <Footprint w={w + 0.6} d={d + 0.6} />
      <Stilts w={w} d={d} h={stiltHeight} />
      <group position={[0, stiltHeight + h / 2, 0]}>
        <mesh>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial {...blueprintMaterialProps(color)} />
          <Edges color={GLOW} threshold={15} />
        </mesh>
        <WireGridBox w={w} h={h} d={d} />
        <Windows w={w} h={h} d={d} />
        {children}
      </group>
    </group>
  )
}

// Renders a bent, multi-segment elevated building following an arbitrary
// polyline (obj.path, given as [x,z] offsets from obj.position). This is
// what lets the main Maitri building match the real station's dogleg shape
// instead of being a single straight box.
function ChainBuilding({ path, size, color, stiltHeight = 1.4 }) {
  const [, h, d] = size
  const segments = []
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i]
    const [bx, bz] = path[i + 1]
    const dx = bx - ax
    const dz = bz - az
    const length = Math.hypot(dx, dz) + 1.1 // small overlap hides the joints
    const angle = Math.atan2(dz, dx)
    const midX = (ax + bx) / 2
    const midZ = (az + bz) / 2
    segments.push({ key: i, midX, midZ, length, angle })
  }

  return (
    <group>
      {segments.map((seg) => (
        <group key={seg.key} position={[seg.midX, 0, seg.midZ]} rotation={[0, -seg.angle, 0]}>
          <ElevatedBox size={[seg.length, h, d]} color={color} stiltHeight={stiltHeight} />
        </group>
      ))}
    </group>
  )
}

function FuelFarmGeo({ size, color }) {
  const [, h] = size
  return (
    <group>
      {[-1.4, 0, 1.4].map((x, i) => (
        <group key={i} position={[x, 0, 0]}>
          <mesh position={[0, h / 2, 0]}>
            <cylinderGeometry args={[1.1, 1.1, h, 20]} />
            <meshStandardMaterial {...blueprintMaterialProps(color)} />
            <Edges color={GLOW} threshold={15} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.6, 3.9, 32]} />
        <meshBasicMaterial color={GLOW} transparent opacity={0.5} />
      </mesh>
    </group>
  )
}

function PumpHouseGeo({ size, color }) {
  const [w, h, d] = size
  return (
    <group>
      <Footprint w={w + 0.5} d={d + 0.5} />
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial {...blueprintMaterialProps(color)} />
        <Edges color={GLOW} threshold={15} />
      </mesh>
      <mesh position={[0, h + 0.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.3, 0.3, w * 0.7, 12]} />
        <meshBasicMaterial color={GLOW} transparent opacity={0.5} />
      </mesh>
    </group>
  )
}

function WasteGeo({ size, color }) {
  const [w, h, d] = size
  return (
    <group>
      <Footprint w={w + 0.5} d={d + 0.5} />
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial {...blueprintMaterialProps(color)} />
        <Edges color={GLOW} threshold={15} />
      </mesh>
      <mesh position={[w / 2 - 0.4, h + 1.2, 0]}>
        <cylinderGeometry args={[0.35, 0.45, 2.4, 12]} />
        <meshStandardMaterial {...blueprintMaterialProps('#6b6259')} />
        <Edges color={GLOW} threshold={15} />
      </mesh>
    </group>
  )
}

function PowerHouseGeo({ size, color }) {
  const [w, h, d] = size
  return (
    <group>
      <Footprint w={w + 0.5} d={d + 0.5} />
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial {...blueprintMaterialProps(color)} />
        <Edges color={GLOW} threshold={15} />
      </mesh>
      {[-0.6, 0.6].map((x, i) => (
        <mesh key={i} position={[x, h + 0.5, d / 2 - 0.5]}>
          <cylinderGeometry args={[0.15, 0.15, 1, 8]} />
          <meshBasicMaterial color={GLOW} transparent opacity={0.6} />
        </mesh>
      ))}
    </group>
  )
}

function HeatingGeo({ size, color }) {
  const [w, h, d] = size
  return (
    <group>
      <Footprint w={w + 0.5} d={d + 0.5} />
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial {...blueprintMaterialProps(color)} />
        <Edges color={GLOW} threshold={15} />
      </mesh>
      <mesh position={[0, h + 0.6, 0]}>
        <cylinderGeometry args={[0.25, 0.3, 1.2, 10]} />
        <meshBasicMaterial color={GLOW} transparent opacity={0.5} />
      </mesh>
    </group>
  )
}

function CommsTowerGeo({ size, color }) {
  const [, h] = size
  return (
    <group>
      <mesh position={[0, h / 2, 0]}>
        <cylinderGeometry args={[0.1, 0.18, h, 8]} />
        <meshBasicMaterial color={GLOW} transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, h + 0.6, 0]}>
        <sphereGeometry args={[0.9, 16, 16]} />
        <meshStandardMaterial {...blueprintMaterialProps('#f2f5f6')} />
        <Edges color={GLOW} threshold={15} />
      </mesh>
      {[0.4, 0.8, 1.2].map((y, i) => (
        <mesh key={i} position={[0, y * (h / 2), 0]}>
          <torusGeometry args={[0.05 + i * 0.15, 0.02, 8, 16]} />
          <meshBasicMaterial color={GLOW} transparent opacity={0.5} />
        </mesh>
      ))}
    </group>
  )
}

function ContainerGeo({ size, color }) {
  const [w, h, d] = size
  return (
    <group>
      <Footprint w={w + 0.4} d={d * 3 + 1.6} />
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, h / 2, i * (d + 0.6) - d - 0.6]}>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial {...blueprintMaterialProps(i === 1 ? color : '#3a6c86')} />
          <Edges color={GLOW} threshold={15} />
        </mesh>
      ))}
    </group>
  )
}

function HelipadGeo({ size, color }) {
  const [w] = size
  return (
    <group>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[w / 2, 32]} />
        <meshBasicMaterial color={GLOW} transparent opacity={0.12} />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[w / 2 - 0.25, w / 2 - 0.1, 32]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Html position={[0, 0.05, 0]} center transform occlude={false} rotation-x={-Math.PI / 2} distanceFactor={22}>
        <div style={{ color: GLOW, fontFamily: 'Space Grotesk', fontSize: 20, fontWeight: 700 }}>H</div>
      </Html>
    </group>
  )
}

function geometryFor(obj) {
  if (obj.path && obj.path.length > 1) {
    return <ChainBuilding path={obj.path} size={obj.size} color={obj.color} />
  }
  switch (obj.type) {
    case 'fuel':
      return obj.id === 'fuel-farm' ? (
        <FuelFarmGeo size={obj.size} color={obj.color} />
      ) : (
        <PumpHouseGeo size={obj.size} color={obj.color} />
      )
    case 'water':
      return <PumpHouseGeo size={obj.size} color={obj.color} />
    case 'waste':
      return <WasteGeo size={obj.size} color={obj.color} />
    case 'electricity':
      return <PowerHouseGeo size={obj.size} color={obj.color} />
    case 'heating':
      return <HeatingGeo size={obj.size} color={obj.color} />
    case 'comms':
      return <CommsTowerGeo size={obj.size} color={obj.color} />
    case 'container':
      return <ContainerGeo size={obj.size} color={obj.color} />
    case 'pad':
      return <HelipadGeo size={obj.size} color={obj.color} />
    case 'lab':
    case 'building':
    default:
      return <ElevatedBox size={obj.size} color={obj.color} />
  }
}

export default function Building({ obj, isSelected, isHovered, onSelect, onHoverStart, onHoverEnd }) {
  const groupRef = useRef()
  const [localHover, setLocalHover] = useState(false)
  const hovered = isHovered || localHover

  useFrame((state) => {
    if (!groupRef.current) return
    const t = state.clock.elapsedTime
    if (isSelected) {
      groupRef.current.rotation.y = Math.sin(t * 0.6) * 0.02
    }
  })

  const isFlat = obj.type === 'pad'
  const labelY = isFlat ? 1.2 : (obj.size?.[1] || 3) + 2.6

  // For bent/chain buildings, size ring/label footprint off the path's
  // bounding box rather than a single obj.size, since the shape spans
  // multiple segments rather than one box.
  let footprint = Math.max(obj.size?.[0] || 2, obj.size?.[2] || 2)
  let ringCenter = [0, 0.03, 0]
  if (obj.path && obj.path.length > 1) {
    const xs = obj.path.map((p) => p[0])
    const zs = obj.path.map((p) => p[1])
    const spanX = Math.max(...xs) - Math.min(...xs)
    const spanZ = Math.max(...zs) - Math.min(...zs)
    footprint = Math.max(spanX, spanZ, obj.size?.[2] || 2)
    ringCenter = [(Math.max(...xs) + Math.min(...xs)) / 2, 0.03, (Math.max(...zs) + Math.min(...zs)) / 2]
  }

  const active = hovered || isSelected

  return (
    <group
      ref={groupRef}
      position={obj.position}
      onPointerOver={(e) => {
        e.stopPropagation()
        setLocalHover(true)
        onHoverStart?.(obj)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={(e) => {
        e.stopPropagation()
        setLocalHover(false)
        onHoverEnd?.(obj)
        document.body.style.cursor = 'auto'
      }}
      onClick={(e) => {
        e.stopPropagation()
        onSelect?.(obj)
      }}
    >
      {geometryFor(obj)}

      {active && (
        <mesh position={ringCenter} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[footprint * 0.42, footprint * 0.48, 48]} />
          <meshBasicMaterial color={isSelected ? GLOW : '#9fd4ea'} transparent opacity={isSelected ? 0.9 : 0.5} />
        </mesh>
      )}

      {/* Always-on compact label, matching the "every label visible" ask —
          it brightens and grows a touch on hover/selection. */}
      <Html position={[ringCenter[0], labelY, ringCenter[2]]} center distanceFactor={26} occlude={false}>
        <div
          style={{
            padding: active ? '6px 10px' : '3px 7px',
            borderRadius: 8,
            background: active ? 'rgba(8,14,20,0.88)' : 'rgba(8,14,20,0.55)',
            border: `1px solid ${isSelected ? GLOW : active ? 'rgba(159,212,234,0.5)' : 'rgba(63,215,255,0.35)'}`,
            color: active ? '#e8f4fb' : '#bfe3f2',
            fontFamily: 'Inter, sans-serif',
            fontSize: active ? 12 : 10,
            fontWeight: active ? 600 : 500,
            whiteSpace: 'nowrap',
            boxShadow: isSelected ? '0 0 16px rgba(63,215,255,0.4)' : 'none',
            pointerEvents: 'none',
            transition: 'all 0.15s ease',
            letterSpacing: active ? 0 : 0.2,
          }}
        >
          <div>{obj.icon} {obj.name}</div>
          {!active && <div style={{ opacity: 0.55, fontSize: 8, marginTop: 1 }}>Click to inspect</div>}
        </div>
      </Html>
    </group>
  )
}
