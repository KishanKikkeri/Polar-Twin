import { useMemo } from 'react'
import * as THREE from 'three'

export default function Road({ path, width = 1.4 }) {
  const shape = useMemo(() => {
    const pts = path.map(([x, z]) => new THREE.Vector3(x, 0.04, z))
    const curve = new THREE.CatmullRomCurve3(pts)
    const divisions = pts.length * 8
    const samples = curve.getPoints(divisions)
    const geo = new THREE.BufferGeometry()
    const positions = []
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i]
      const b = samples[i + 1]
      const dir = new THREE.Vector3().subVectors(b, a).normalize()
      const normal = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(width / 2)
      positions.push(
        a.x - normal.x, a.y, a.z - normal.z,
        a.x + normal.x, a.y, a.z + normal.z,
        b.x - normal.x, b.y, b.z - normal.z,
        a.x + normal.x, a.y, a.z + normal.z,
        b.x + normal.x, b.y, b.z + normal.z,
        b.x - normal.x, b.y, b.z - normal.z,
      )
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.computeVertexNormals()
    return geo
  }, [path, width])

  return (
    <mesh geometry={shape} receiveShadow>
      <meshStandardMaterial color="#9aa6ad" roughness={0.9} />
    </mesh>
  )
}
