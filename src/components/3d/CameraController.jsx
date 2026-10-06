import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

export const OVERVIEW_POS = new THREE.Vector3(56, 46, 60)
export const OVERVIEW_TARGET = new THREE.Vector3(0, 0, 0)

export default function CameraController({ controlsRef, selected }) {
  const { camera } = useThree()
  const desiredPos = useRef(OVERVIEW_POS.clone())
  const desiredTarget = useRef(OVERVIEW_TARGET.clone())

  useEffect(() => {
    if (selected) {
      const [x, y, z] = selected.position
      const height = (selected.size?.[1] || 3) + 4
      let spread = Math.max(selected.size?.[0] || 4, selected.size?.[2] || 4)
      let cx = x
      let cz = z
      if (selected.path && selected.path.length > 1) {
        const xs = selected.path.map((p) => p[0])
        const zs = selected.path.map((p) => p[1])
        const spanX = Math.max(...xs) - Math.min(...xs)
        const spanZ = Math.max(...zs) - Math.min(...zs)
        spread = Math.max(spanX, spanZ, selected.size?.[2] || 4) * 0.6
        cx = x + (Math.max(...xs) + Math.min(...xs)) / 2
        cz = z + (Math.max(...zs) + Math.min(...zs)) / 2
      }
      desiredPos.current.set(cx + spread * 1.4 + 4, height + 3, cz + spread * 1.4 + 4)
      desiredTarget.current.set(cx, height * 0.35, cz)
    } else {
      desiredPos.current.copy(OVERVIEW_POS)
      desiredTarget.current.copy(OVERVIEW_TARGET)
    }
  }, [selected])

  useFrame((_, delta) => {
    const lerpFactor = 1 - Math.pow(0.001, delta) // ~0.8-1.5s settle
    camera.position.lerp(desiredPos.current, lerpFactor)
    if (controlsRef.current) {
      controlsRef.current.target.lerp(desiredTarget.current, lerpFactor)
      controlsRef.current.update()
    }
  })

  return null
}
