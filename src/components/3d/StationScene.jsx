import { Suspense, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import Terrain from './Terrain.jsx'
import Building from './Building.jsx'
import UtilityMarker from './UtilityMarker.jsx'
import Road from './Road.jsx'
import CameraController, { OVERVIEW_POS, OVERVIEW_TARGET } from './CameraController.jsx'

const UTILITY_LAYERS = new Set(['electricity', 'fuel', 'water', 'heating', 'communication', 'waste'])

// Generic 3D scene for any station: pass in that station's object layout and
// road paths and it renders the same terrain/building/marker/camera system.
// This is what makes Maitri and Bharati (and future stations) reuse one
// implementation instead of duplicating the whole 3D stack.
export default function StationScene({
  stationKey,
  objects,
  roadPaths,
  terrain,
  selectedId,
  hoveredId,
  onSelect,
  onHoverStart,
  onHoverEnd,
  layers,
}) {
  const controlsRef = useRef()
  const selected = objects.find((o) => o.id === selectedId) || null
  const visibleObjects = objects.filter((o) => layers[o.layer] !== false)

  return (
    <Canvas
      key={stationKey}
      shadows
      camera={{ position: OVERVIEW_POS.toArray(), fov: 42, near: 0.5, far: 500 }}
      gl={{ antialias: true }}
      dpr={[1, 1.75]}
    >
      <color attach="background" args={['#0d1620']} />
      <fog attach="fog" args={['#12212b', 60, 210]} />

      <ambientLight intensity={0.55} color="#cfe7f5" />
      <directionalLight
        position={[40, 60, 20]}
        intensity={1.4}
        color="#fdfaf3"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
      />
      <hemisphereLight args={['#bcd9ea', '#0d1620', 0.5]} />

      <Suspense fallback={null}>
        {layers.buildings !== false && (
          <Terrain
            rockPatches={terrain?.rockPatches}
            water={terrain?.water}
            decor={terrain?.decor}
            groundImage={terrain?.groundImage}
          />
        )}

        {layers.roads !== false && roadPaths.map((p, i) => <Road key={i} path={p} />)}

        {visibleObjects.map((obj) => (
          <Building
            key={obj.id}
            obj={obj}
            isSelected={selectedId === obj.id}
            isHovered={hoveredId === obj.id}
            onSelect={onSelect}
            onHoverStart={onHoverStart}
            onHoverEnd={onHoverEnd}
          />
        ))}

        {visibleObjects
          .filter((o) => UTILITY_LAYERS.has(o.layer))
          .map((obj) => (
            <UtilityMarker key={`marker-${obj.id}`} obj={obj} onSelect={onSelect} isSelected={selectedId === obj.id} />
          ))}
      </Suspense>

      <CameraController controlsRef={controlsRef} selected={selected} />

      {/* Always enabled — 360° rotation must keep working with a building
          selected or the dashboard open. Panels are HTML overlays outside
          the canvas and stop their own pointer events, so they never fight
          OrbitControls for input. */}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enablePan
        enableRotate
        enableZoom
        minDistance={10}
        maxDistance={150}
        maxPolarAngle={Math.PI / 2.05}
        target={OVERVIEW_TARGET.toArray()}
        enableDamping
        dampingFactor={0.08}
        mouseButtons={{ LEFT: 0, MIDDLE: 1, RIGHT: 2 }}
      />
    </Canvas>
  )
}
