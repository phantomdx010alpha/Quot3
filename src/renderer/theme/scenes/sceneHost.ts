import type * as THREE_NS from 'three'
import { budgetBlown, SCENE_LIMITS, shouldDrawFrame, type ResolvedScene, type SceneRunState } from '@shared/theme/scenes'
import { builderFor } from './registry'
import type { SceneInstance, ThreeLib } from './types'

/**
 * Phase 169: owns one <canvas>. three.js is imported lazily the first time a scene is wanted (no network, no remote assets, no eval:
 * it is bundled with the app and loaded from 'self'). Any failure (no WebGL, context lost, a scene that throws, a blown frame budget)
 * calls `onFail` once and leaves the canvas blank; the plain theme shows. Frames are capped, nothing runs while paused, and
 * everything is disposed on scene change. Never on the keystroke path: this only draws on its own rAF loop.
 */
export interface SceneHost {
  setScene(scene: ResolvedScene | null): void
  setRunState(state: SceneRunState): void
  dispose(): void
}

export function createSceneHost(canvas: HTMLCanvasElement, onFail: (reason: string) => void, loader: () => Promise<ThreeLib> = () => import('three')): SceneHost {
  let three: ThreeLib | null = null
  let renderer: THREE_NS.WebGLRenderer | null = null
  let scene: THREE_NS.Scene | null = null
  let camera: THREE_NS.PerspectiveCamera | null = null
  let inst: SceneInstance | null = null
  let wanted: ResolvedScene | null = null
  let state: SceneRunState = 'off'
  let raf = 0
  let t0 = 0
  let last = 0
  let disposed = false
  let gen = 0
  let frames: number[] = []
  let ro: ResizeObserver | null = null
  let failed = false

  const fail = (reason: string): void => {
    if (failed) return
    failed = true
    teardownScene()
    cancel()
    onFail(reason)
  }
  const cancel = (): void => { if (raf) { cancelAnimationFrame(raf); raf = 0 } }
  const size = (): void => {
    if (!renderer || !camera) return
    const w = Math.max(1, canvas.clientWidth)
    const h = Math.max(1, canvas.clientHeight)
    renderer.setPixelRatio(Math.min(SCENE_LIMITS.maxPixelRatio, window.devicePixelRatio || 1))
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  function teardownScene(): void {
    try { inst?.dispose() } catch { /* already gone */ }
    inst = null
    if (scene) scene.traverse((o) => {
      const m = o as THREE_NS.Mesh
      m.geometry?.dispose?.()
      const mat = m.material as THREE_NS.Material | THREE_NS.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.()
    })
    if (renderer) { renderer.clear(); }
    frames = []
  }
  const frame = (now: number): void => {
    raf = 0
    if (disposed || state !== 'run' || !renderer || !scene || !camera || !inst) return
    raf = requestAnimationFrame(frame)
    if (!shouldDrawFrame(last, now)) return
    const start = performance.now()
    try {
      inst.update((now - t0) / 1000)
      renderer.render(scene, camera)
    } catch { fail('scene error'); return }
    frames.push(performance.now() - start)
    if (frames.length > SCENE_LIMITS.budgetWindow * 2) frames = frames.slice(-SCENE_LIMITS.budgetWindow)
    if (budgetBlown(frames)) fail('frame budget')
    last = now
  }
  const sync = (): void => {
    cancel()
    if (disposed || failed) return
    if (state === 'off' || !wanted) { if (state === 'off') { teardownScene(); canvas.style.visibility = 'hidden' } return }
    if (state === 'paused') return
    canvas.style.visibility = 'visible'
    if (inst) { last = 0; raf = requestAnimationFrame(frame) }
  }
  const build = async (): Promise<void> => {
    const my = ++gen
    teardownScene()
    if (!wanted || state === 'off') { sync(); return }
    const builder = builderFor(wanted.scene)
    if (!builder) { sync(); return }
    try {
      if (!three) three = await loader()
      if (my !== gen || disposed) return
      if (!renderer) {
        renderer = new three.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' })
        renderer.setClearColor(0x000000, 0)
        canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); fail('context lost') })
        ro = typeof ResizeObserver === 'function' ? new ResizeObserver(size) : null
        ro?.observe(canvas)
      }
      scene = new three.Scene()
      camera = new three.PerspectiveCamera(50, 1, 0.1, 100)
      size()
      inst = builder({ THREE: three, scene, camera, params: wanted })
      t0 = performance.now()
      inst.update(0)
      renderer.render(scene, camera) // one frame even when paused, so the background is visible
      sync()
    } catch { fail('WebGL not available') }
  }

  return {
    setScene(s) { wanted = s; failed = false; void build() },
    setRunState(next) {
      if (next === state) return
      const was = state
      state = next
      if (was === 'off' && next !== 'off' && wanted && !inst) void build(); else sync()
    },
    dispose() {
      disposed = true
      cancel(); ro?.disconnect(); teardownScene()
      try { renderer?.dispose(); renderer?.forceContextLoss() } catch { /* ignore */ }
      renderer = null; scene = null; camera = null
    }
  }
}
