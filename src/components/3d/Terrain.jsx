import { useMemo } from 'react'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'

// Procedural snow terrain with gentle elevation noise so it doesn't read
// as a flat plane. Uses a single geometry + displaced vertices, no external
// heightmap needed.
function makeTerrainGeometry(size = 220, segments = 90) {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const n =
      Math.sin(x * 0.04) * 0.6 +
      Math.cos(y * 0.05) * 0.5 +
      Math.sin((x + y) * 0.02) * 0.8
    const dist = Math.sqrt(x * x + y * y)
    const settle = Math.max(0, 1 - dist / 90)
    pos.setZ(i, n * 0.5 * (0.4 + settle))
  }
  geo.computeVertexNormals()
  return geo
}

// A small stack of coloured supply drums — a purely decorative nod to the
// fuel-drum pallets visible near Maitri's frozen lake in reference photos.
function DrumStack({ position }) {
  const colors = ['#c94f4f', '#e0b23d', '#3f6fae', '#c94f4f', '#e0b23d']
  return (
    <group position={[position[0], 0, position[1]]}>
      {colors.map((c, i) => {
        const row = Math.floor(i / 3)
        const col = i % 3
        return (
          <mesh key={i} position={[col * 0.9 - 0.9, 0.45 + row * 0.9, row * 0.2]} castShadow>
            <cylinderGeometry args={[0.42, 0.42, 0.85, 12]} />
            <meshStandardMaterial color={c} roughness={0.6} metalness={0.2} />
          </mesh>
        )
      })}
    </group>
  )
}

// When a station provides a real aerial reference photo, we texture the
// ground plane with it (darkened/tinted) so the glowing wireframe "digital
// twin" buildings read as a hologram rising out of the real site, echoing
// the station's own reference concept art.
function PhotoGround({ geometry, imageUrl }) {
  const texture = useTexture(imageUrl)
  texture.colorSpace = THREE.SRGBColorSpace
  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
      {/* Unlit so the reference photo reads at full, true brightness
          regardless of the scene's directional/ambient lighting — this is
          meant to look like a real aerial photo, not a lit 3D surface. */}
      <meshBasicMaterial map={texture} color="#789da8" toneMapped={false} fog={false} />
    </mesh>
  )
}

const DEFAULT_ROCKS = [
  [-34, -8, 16, 0.4],
  [-10, -20, 10, 1.1],
  [22, 24, 12, 0.7],
  [40, 0, 14, 2.1],
  [0, 8, 20, 0.2],
]

const DEFAULT_WATER = [{ position: [-46, -18], radius: 9, color: '#3a6c86', style: 'melt' }]

export default function Terrain({ rockPatches = DEFAULT_ROCKS, water = DEFAULT_WATER, decor = [], groundImage = null }) {
  const geometry = useMemo(() => makeTerrainGeometry(), [])

  return (
    <group>
      {groundImage ? (
        <PhotoGround geometry={geometry} imageUrl={groundImage} />
      ) : (
        <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <meshStandardMaterial color="#e9f2f7" roughness={0.95} metalness={0} />
        </mesh>
      )}

      {/* rocky exposed patches, evoking the Schirmacher Oasis outcrops —
          skipped over a photo ground since the photo already shows rock */}
      {!groundImage &&
        rockPatches.map((r, i) => (
          <mesh key={i} position={[r[0], -0.05, r[1]]} rotation={[-Math.PI / 2, 0, r[3]]} receiveShadow>
            <circleGeometry args={[r[2], 24]} />
            <meshStandardMaterial color="#5b5049" roughness={1} />
          </mesh>
        ))}

      {/* lakes / meltwater ponds — 'frozen' reads pale/icy, 'melt' reads as
          the turquoise open water seen near the station in summer */}
      {!groundImage &&
        water.map((w, i) => (
          <mesh key={i} position={[w.position[0], -0.02, w.position[1]]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[w.radius, 40]} />
            <meshStandardMaterial
              color={w.color || (w.style === 'frozen' ? '#d7e6ec' : '#3a6c86')}
              roughness={w.style === 'frozen' ? 0.5 : 0.15}
              metalness={w.style === 'frozen' ? 0.05 : 0.3}
            />
          </mesh>
        ))}

      {!groundImage &&
        decor.map((d, i) => (d.type === 'drums' ? <DrumStack key={i} position={d.position} /> : null))}

      {/* faint holographic grid — reinforces the "digital twin blueprint"
          feel whether or not a photo ground is in use */}
      <gridHelper args={[220, 44, '#3fd7ff', '#3fd7ff']} position={[0, 0.03, 0]} material-transparent material-opacity={groundImage ? 0.24 : 0.08} />
    </group>
  )
}
