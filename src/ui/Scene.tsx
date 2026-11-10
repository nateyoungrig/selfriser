import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Html, Line, OrbitControls, OrthographicCamera } from '@react-three/drei'
import * as THREE from 'three'
import type { Rig, StageDesign } from '../model/types'
import type { LevelReport, Status } from '../lib/level'
import { interpolate, shapeFunctions } from '../lib/surface'
import { formatDeltaCompact } from '../lib/units'
import { useBlobUrl } from '../model/blobs'
import { useUi, type ViewName } from '../app/ui'
import { deviationColor, STATUS_COLOR } from './colors'

// The roof in 3D: towers, truss runs and a contour plot of how far each spot sits off average, over
// the stage's own plan drawing when it came from one. Shared by the field and the Lab; what colors the
// tower columns is up to the caller.

interface Node { x: number; y: number; phi: number[] }

const SEGMENT_FT = 5

function nodesAlong(rig: Rig, a: [number, number], b: [number, number], seg: number): Node[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / seg))
  return Array.from({ length: n + 1 }, (_, i) => {
    const x = a[0] + ((b[0] - a[0]) * i) / n, y = a[1] + ((b[1] - a[1]) * i) / n
    return { x, y, phi: shapeFunctions(rig.towers, x, y) }
  })
}

/** Everything that depends only on the layout: sample points and their shape functions. */
function buildLayout(rig: StageDesign) {
  const xs = [rig.roof.x0, rig.roof.x1, ...rig.members.flatMap((m) => [m.a[0], m.b[0]]), ...rig.towers.map((t) => t.x)]
  const ys = [rig.roof.y0, rig.roof.y1, ...rig.members.flatMap((m) => [m.a[1], m.b[1]]), ...rig.towers.map((t) => t.y)]
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  // Marker sizes are in feet, drawn for full-size roofs; a tabletop model shrinks them to fit.
  const u = Math.min(1, Math.max(x1 - x0, y1 - y0, rig.towerHeightFt) / 50)
  const seg = SEGMENT_FT * u

  const surfaceFt = Math.max((x1 - x0) / 60, (y1 - y0) / 60, 0.05)
  const nx = Math.max(2, Math.ceil((x1 - x0) / surfaceFt)), ny = Math.max(2, Math.ceil((y1 - y0) / surfaceFt))
  const surface: Node[] = []
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx, y = y0 + ((y1 - y0) * j) / ny
      surface.push({ x, y, phi: shapeFunctions(rig.towers, x, y) })
    }
  const index: number[] = []
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const p = j * (nx + 1) + i
      index.push(p, p + nx + 1, p + 1, p + 1, p + nx + 1, p + nx + 2)
    }

  const towerIndex = new Map(rig.towers.map((t, i) => [t.id, i]))
  const yRanks = [...new Set(rig.towers.map((t) => Math.round(t.y / u)))].sort((a, b) => a - b)
  return {
    x0, x1, y0, y1, cx, cy, u, surface, index,
    members: rig.members.map((m) => nodesAlong(rig, m.a, m.b, seg)),
    pairs: rig.adjacency.map(([a, b]) => {
      const ta = rig.towers[towerIndex.get(a)!], tb = rig.towers[towerIndex.get(b)!]
      return nodesAlong(rig, [ta.x, ta.y], [tb.x, tb.y], seg)
    }),
    // Alternate label side by row so upstage/downstage labels don't stack in the front view.
    labelBelow: rig.towers.map((t) => yRanks.indexOf(Math.round(t.y / u)) % 2 === 1),
  }
}

type Layout = ReturnType<typeof buildLayout>

const VIEW_DIR: Record<ViewName, [number, number, number]> = {
  iso: [-0.9, 0.75, 1.25],
  front: [0, 0, 1], // from the audience: stage right on the left
  side: [-1, 0, 0], // from stage right: upstage on the left, as drawn
  plan: [0, 1, 0.002], // upstage at the top
}

function ViewController({ layout, heightFt }: { layout: Layout; heightFt: number }) {
  const view = useUi((s) => s.view)
  const nonce = useUi((s) => s.viewNonce)
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)

  useLayoutEffect(() => {
    const target = new THREE.Vector3(0, heightFt / 2, 0)
    camera.up.set(0, 1, 0)
    camera.position.copy(target).addScaledVector(new THREE.Vector3(...VIEW_DIR[view]).normalize(), 800 * layout.u)
    camera.lookAt(target)
    camera.updateMatrixWorld()
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
    const hw = (layout.x1 - layout.x0) / 2 + 6 * layout.u, hd = (layout.y1 - layout.y0) / 2 + 6 * layout.u
    let r = 0.1, u = 0.1
    for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) {
      const v = new THREE.Vector3(sx * hw, sy * (heightFt + 8 * layout.u), sz * hd).sub(target)
      r = Math.max(r, Math.abs(v.dot(right)))
      u = Math.max(u, Math.abs(v.dot(up)))
    }
    camera.zoom = 0.94 * Math.min(size.width / (2 * r), size.height / (2 * u))
    camera.near = 0.01
    camera.far = 4000 * layout.u
    camera.updateProjectionMatrix()
    if (controls) { controls.target.copy(target); controls.update() }
    invalidate()
  }, [view, nonce, layout, heightFt, size.width, size.height, camera, controls, invalidate])
  return null
}

const FLY_KEYS = ['w', 'a', 's', 'd', 'q', 'e']

/** WASD slides the camera over the deck (Q / E down / up, Shift = faster). */
function FlyControls() {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null
  const invalidate = useThree((s) => s.invalidate)
  const keys = useRef(new Set<string>())

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (e.ctrlKey || e.metaKey || e.altKey || !FLY_KEYS.includes(k)) return
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName) || useUi.getState().sheet || useUi.getState().editor) return
      keys.current.add(k)
      if (e.shiftKey) keys.current.add('shift'); else keys.current.delete('shift')
      invalidate()
    }
    const up = (e: KeyboardEvent) => { keys.current.delete(e.key.toLowerCase()); if (!e.shiftKey) keys.current.delete('shift') }
    const clear = () => keys.current.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear) }
  }, [invalidate])

  useFrame((_, dt) => {
    const k = keys.current
    if (!FLY_KEYS.some((f) => k.has(f)) || !controls) return
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
    // "Forward" is along the deck; looking straight down, that is up the screen.
    const forward = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2).negate().setY(0)
    if (forward.lengthSq() < 1e-4) forward.setFromMatrixColumn(camera.matrixWorld, 1).setY(0)
    forward.normalize()
    right.setY(0).normalize()
    const move = new THREE.Vector3()
      .addScaledVector(forward, (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0))
      .addScaledVector(right, (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0))
      .add(new THREE.Vector3(0, (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0), 0))
    // Constant speed on screen: about half the view width per second.
    const speed = ((k.has('shift') ? 2.5 : 1) * 450) / camera.zoom
    move.multiplyScalar(speed * Math.min(dt, 0.1))
    camera.position.add(move)
    controls.target.add(move)
    controls.update()
    invalidate()
  })
  return null
}

/** The SolidWorks-style plot: roof surface colored by how far each spot sits above/below average. */
function ContourSurface({ layout, shownFt, devIn, stopIn, faded }: { layout: Layout; shownFt: number[]; devIn: number[]; stopIn: number; faded: boolean }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(layout.surface.length * 3), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(layout.surface.length * 3), 3))
    g.setIndex(layout.index)
    return g
  }, [layout])
  useEffect(() => () => geometry.dispose(), [geometry])

  useLayoutEffect(() => {
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute
    const col = geometry.getAttribute('color') as THREE.BufferAttribute
    const c = new THREE.Color()
    layout.surface.forEach((n, k) => {
      pos.setXYZ(k, n.x - layout.cx, interpolate(n.phi, shownFt) - 0.4 * layout.u, n.y - layout.cy)
      c.set(faded ? '#475569' : deviationColor(interpolate(n.phi, devIn), stopIn))
      col.setXYZ(k, c.r, c.g, c.b)
    })
    pos.needsUpdate = true
    col.needsUpdate = true
    geometry.computeBoundingSphere()
  }, [geometry, layout, shownFt, devIn, stopIn, faded])

  return (
    <mesh geometry={geometry} renderOrder={1}>
      <meshBasicMaterial vertexColors transparent opacity={faded ? 0.35 : 0.72} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

/** Pulses whatever it wraps; used for the red "stop" glow. */
function Pulse({ children, min = 0.15, max = 0.6 }: { children: React.ReactNode; min?: number; max?: number }) {
  const ref = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    const k = min + (max - min) * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 5))
    ref.current?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined
      if (m && 'opacity' in m) m.opacity = k
    })
  })
  return <group ref={ref}>{children}</group>
}

/** The plan drawing on the deck, under the roof. */
function Underlay({ url, rect, layout }: { url: string; rect: { x0: number; y0: number; x1: number; y1: number }; layout: Layout }) {
  const texture = useLoader(THREE.TextureLoader, url)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(rect.x0 + rect.x1) / 2 - layout.cx, -0.6 * layout.u, (rect.y0 + rect.y1) / 2 - layout.cy]}>
      <planeGeometry args={[rect.x1 - rect.x0, rect.y1 - rect.y0]} />
      <meshBasicMaterial map={texture} transparent opacity={0.85} toneMapped={false} />
    </mesh>
  )
}

export interface SceneProps {
  rig: StageDesign
  heightsIn: number[]
  known: boolean[]
  report: LevelReport
  selected: number | null
  onSelect(i: number | null): void
  /** Color of each tower's column: where its height comes from (field) or the load it carries (Lab). */
  towerColor(i: number): string
  /** Towers drawn dimmed (switched off in the Lab). */
  dimmed?: boolean[]
}

function TowerMarker({ rig, layout, i, shownFt, meanFt, report, selected, color, known, dim, onSelect }: {
  rig: Rig; layout: Layout; i: number; shownFt: number; meanFt: number; report: LevelReport; selected: boolean; color: string; known: boolean; dim: boolean; onSelect(i: number): void
}) {
  const t = rig.towers[i]
  const status: Status = report.towerStatus[i]
  const dev = report.devIn[i]
  const x = t.x - layout.cx, z = t.y - layout.cy
  const arrow = shownFt - meanFt
  const devColor = deviationColor(dev, rig.tolerance.stopIn)
  const u = layout.u
  const block = <boxGeometry args={[5 * u, 3.2 * u, 5 * u]} />

  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, rig.towerHeightFt / 2, 0]}>
        <boxGeometry args={[2.5 * u, rig.towerHeightFt, 2.5 * u]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>

      <mesh position={[0, shownFt, 0]} onClick={(e) => { e.stopPropagation(); onSelect(i) }}>
        {block}
        {known ? <meshBasicMaterial color={STATUS_COLOR[status]} toneMapped={false} /> : <meshBasicMaterial color="#94a3b8" wireframe />}
      </mesh>
      {selected && (
        <mesh position={[0, shownFt, 0]}>
          <boxGeometry args={[7 * u, 5 * u, 7 * u]} />
          <meshBasicMaterial color="#ffffff" wireframe />
        </mesh>
      )}
      {status !== 'ok' && (
        <Pulse min={status === 'stop' ? 0.15 : 0.12} max={status === 'stop' ? 0.6 : 0.12}>
          <mesh position={[0, shownFt, 0]} renderOrder={3}>
            <sphereGeometry args={[(status === 'stop' ? 10 : 7) * u, 20, 14]} />
            <meshBasicMaterial color={STATUS_COLOR[status]} transparent opacity={0.3} depthWrite={false} toneMapped={false} />
          </mesh>
        </Pulse>
      )}

      {/* How far off average, drawn from the average plane to the sleeve block. */}
      {known && Math.abs(arrow) > 0.6 * u && (
        <group position={[3.6 * u, 0, 3.6 * u]}>
          <Line points={[[0, meanFt, 0], [0, shownFt, 0]]} color={devColor} lineWidth={4} toneMapped={false} />
          <mesh position={[0, shownFt, 0]} rotation={[arrow > 0 ? 0 : Math.PI, 0, 0]}>
            <coneGeometry args={[1.8 * u, 3.6 * u, 10]} />
            <meshBasicMaterial color={devColor} toneMapped={false} />
          </mesh>
        </group>
      )}

      <Html position={[0, shownFt + (layout.labelBelow[i] ? -7 : 7) * u, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`tower-tag ${status} ${dim || !known ? 'off' : ''}`}>
          <b>{t.label}</b>
          <span style={{ color: known ? devColor : undefined }}>{known ? formatDeltaCompact(dev) : '?'}</span>
        </div>
      </Html>
    </group>
  )
}

function Roof3D({ rig, heightsIn, known, report, selected, onSelect, towerColor, dimmed }: SceneProps) {
  const k = useUi((s) => s.exaggeration)
  const layout = useMemo(() => buildLayout(rig), [rig])
  const underlayUrl = useBlobUrl(rig.drawing?.underlay?.key)
  const anyKnown = known.some(Boolean)

  // True average height, deviations stretched k times so inches read on a 260 ft roof.
  const meanFt = report.meanIn / 12
  const shownFt = useMemo(() => heightsIn.map((h) => (report.meanIn + k * (h - report.meanIn)) / 12), [heightsIn, report, k])

  const world = (n: Node): [number, number, number] => [n.x - layout.cx, interpolate(n.phi, shownFt), n.y - layout.cy]
  const hw = (layout.x1 - layout.x0) / 2, hd = (layout.y1 - layout.y0) / 2

  return (
    <>
      <OrthographicCamera makeDefault position={[0, 100, 800]} />
      {/* Left drag pans, right drag orbits, wheel zooms. Touch: one finger pans, two fingers zoom + orbit. */}
      <OrbitControls
        makeDefault enableDamping={false} maxPolarAngle={Math.PI / 2} zoomToCursor
        mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
        touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }}
      />
      <ViewController layout={layout} heightFt={rig.towerHeightFt} />
      <FlyControls />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -layout.u, 0]}>
        <planeGeometry args={[2 * hw + 24 * layout.u, 2 * hd + 24 * layout.u]} />
        <meshBasicMaterial color="#1b222c" />
      </mesh>
      {underlayUrl && rig.drawing?.underlay && <Suspense fallback={null}><Underlay url={underlayUrl} rect={rig.drawing.underlay} layout={layout} /></Suspense>}

      {/* Where the roof would be if it were dead level at the current average. */}
      {anyKnown && (
        <Line
          points={[[-hw, meanFt, -hd], [hw, meanFt, -hd], [hw, meanFt, hd], [-hw, meanFt, hd], [-hw, meanFt, -hd]]}
          color="#e5e7eb" lineWidth={1} dashed dashSize={3 * layout.u} gapSize={3 * layout.u} transparent opacity={0.55}
        />
      )}

      <ContourSurface layout={layout} shownFt={shownFt} devIn={report.devIn} stopIn={rig.tolerance.stopIn} faded={!anyKnown} />

      {layout.members.map((nodes, m) => (
        <Line key={rig.members[m].id} points={nodes.map(world)} color="#dbe2ea" lineWidth={rig.members[m].kind === 'main' ? 2.5 : 1.5} toneMapped={false} />
      ))}

      {/* Runs between towers that are out of tolerance with each other light up. */}
      {report.pairs.map((p) => {
        if (p.status === 'ok') return null
        const n = rig.adjacency.findIndex(([a, b]) => a === p.a && b === p.b)
        if (n < 0) return null
        return (
          <group key={`${p.a}-${p.b}`}>
            <Line points={layout.pairs[n].map(world)} color={STATUS_COLOR[p.status]} lineWidth={5} toneMapped={false} renderOrder={4} />
            <Pulse min={p.status === 'stop' ? 0.1 : 0.25} max={p.status === 'stop' ? 0.55 : 0.25}>
              <Line points={layout.pairs[n].map(world)} color={STATUS_COLOR[p.status]} lineWidth={16} transparent opacity={0.3} depthWrite={false} toneMapped={false} renderOrder={4} />
            </Pulse>
          </group>
        )
      })}

      {rig.towers.map((t, i) => (
        <TowerMarker
          key={t.id} rig={rig} layout={layout} i={i} report={report} meanFt={meanFt} shownFt={shownFt[i]} selected={selected === i}
          color={towerColor(i)} known={known[i]} dim={!!dimmed?.[i]} onSelect={onSelect}
        />
      ))}
    </>
  )
}

export function Scene(props: SceneProps) {
  // Only spin the render loop when something is pulsing; otherwise draw on change to save battery.
  const pulsing = props.report.status === 'stop'
  return (
    <Canvas frameloop={pulsing ? 'always' : 'demand'} dpr={[1, 2]} gl={{ antialias: true }} onContextMenu={(e) => e.preventDefault()} onPointerMissed={() => props.onSelect(null)}>
      <color attach="background" args={['#0d1117']} />
      <Roof3D {...props} />
    </Canvas>
  )
}
