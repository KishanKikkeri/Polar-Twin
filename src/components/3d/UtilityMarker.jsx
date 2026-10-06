import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'

const COLORS = {
  electricity: '#fbbf24',
  fuel: '#fb923c',
  water: '#38bdf8',
  heating: '#f87171',
  communication: '#a78bfa',
  waste: '#4ade80',
  lab: '#34d399',
}

export default function UtilityMarker({ obj, onSelect, isSelected }) {
  const ref = useRef()
  const [hovered, setHovered] = useState(false)
  const height = (obj.size?.[1] || 3) + 3.4
  const color = COLORS[obj.layer] || '#3fd7ff'

  useFrame((state) => {
    if (!ref.current) return
    ref.current.position.y = height + Math.sin(state.clock.elapsedTime * 1.4 + obj.position[0]) * 0.15
  })

  return (
    <group position={[obj.position[0], 0, obj.position[2]]}>
      <group
        ref={ref}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={(e) => {
          e.stopPropagation()
          setHovered(false)
          document.body.style.cursor = 'auto'
        }}
        onClick={(e) => {
          e.stopPropagation()
          onSelect?.(obj)
        }}
      >
        <Html center distanceFactor={24} occlude={false}>
          <div
            style={{
              width: hovered || isSelected ? 34 : 26,
              height: hovered || isSelected ? 34 : 26,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: `radial-gradient(circle, ${color}33, rgba(6,10,15,0.75))`,
              border: `1px solid ${color}`,
              boxShadow: `0 0 ${hovered || isSelected ? 18 : 10}px ${color}88`,
              transition: 'all 0.18s ease',
              fontSize: hovered || isSelected ? 15 : 12,
              cursor: 'pointer',
            }}
          >
            {obj.icon}
          </div>
          {hovered && (
            <div
              style={{
                marginTop: 6,
                padding: '4px 8px',
                borderRadius: 6,
                background: 'rgba(8,14,20,0.9)',
                border: `1px solid ${color}`,
                color: '#e8f4fb',
                fontSize: 11,
                fontFamily: 'Inter, sans-serif',
                whiteSpace: 'nowrap',
                transform: 'translateX(-50%)',
                position: 'absolute',
                left: '50%',
              }}
            >
              {obj.name}
            </div>
          )}
        </Html>
      </group>
    </group>
  )
}
