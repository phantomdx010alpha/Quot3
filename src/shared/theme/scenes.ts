// Phase 169 (pure): turns a theme's validated `background` section into the numbers a built-in 3D scene uses, and decides when the
// scene runs, pauses or is off. A theme only PICKS a scene by name with colours / density / speed / intensity; geometry, shaders and
// every cap live in the app (renderer/theme/scenes/*). No DOM, no three.js here, so it is unit-testable and shared.
import { SCENE_NAMES, type BackgroundSpec } from './schemaV2'

/** Master switch for 3D backgrounds (Settings > Themes > Visual effects). Default ON, used only when a theme asks for a scene [A]. */
export const SCENES_ENABLED_KEY = 'effects.scenes3d'
export const SCENES_ENABLED_DEFAULT = true

/** Scene names that actually draw something (`none` is allowed in a theme but draws nothing). */
export const DRAWN_SCENES = ['particles', 'waves', 'gradient-mesh'] as const
export type SceneName = (typeof DRAWN_SCENES)[number]

/** Frame cap [A: 60 fps] and the budget rules. A frame that takes longer than `slowMs` counts as slow; too many in a window = give up. */
export const SCENE_LIMITS = {
  maxFps: 60,
  /** Pixel ratio never above this (cheap on 4K screens). */
  maxPixelRatio: 1.5,
  maxParticles: 1200,
  minParticles: 40,
  waveSegments: { min: 16, max: 64 },
  slowFrameMs: 40,
  budgetWindow: 90,
  budgetMaxSlow: 45
} as const

export const SCENE_DEFAULT_COLORS: Readonly<Record<SceneName, readonly string[]>> = {
  particles: ['#7aa2ff', '#ffffff'],
  waves: ['#2a6cff', '#7aa2ff'],
  'gradient-mesh': ['#2a6cff', '#c24dff', '#ff6b6b']
}

export interface ResolvedScene {
  scene: SceneName
  /** 1 to 4 colours as 0..1 RGB triples. */
  colors: [number, number, number][]
  /** Scene-specific size: particle count for `particles`, grid segments for `waves`, 0 for `gradient-mesh`. */
  count: number
  speed: number
  intensity: number
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))

/** Parses a hex (#rgb #rgba #rrggbb #rrggbbaa) or rgb()/rgba() colour (already validated by the theme loader) to 0..1 RGB. Alpha is ignored. Returns null if unusable. */
export function parseColorRGB(value: string): [number, number, number] | null {
  const v = value.trim()
  let m = /^#([0-9a-f]{3,8})$/i.exec(v)
  if (m) {
    let h: string = m[1] ?? ''
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    if (h.length !== 6 && h.length !== 8) return null
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]
  }
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(v)
  if (m) return [1, 2, 3].map((i) => clamp(Number(m![i]), 0, 255) / 255) as [number, number, number]
  return null
}

/** Resolves a theme's background. Unknown scene, `none` or no background = null (no 3D layer); the loader already warned about unknown names. */
export function resolveScene(bg: BackgroundSpec | undefined): ResolvedScene | null {
  if (!bg || !SCENE_NAMES.includes(bg.scene)) return null
  if (!(DRAWN_SCENES as readonly string[]).includes(bg.scene)) return null
  const scene = bg.scene as SceneName
  const given = bg.colors.map(parseColorRGB).filter((c): c is [number, number, number] => c !== null).slice(0, 4)
  const colors = given.length > 0 ? given : SCENE_DEFAULT_COLORS[scene].map((c) => parseColorRGB(c)!)
  const d = clamp(bg.density, 0, 1)
  const count =
    scene === 'particles'
      ? Math.round(SCENE_LIMITS.minParticles + d * (SCENE_LIMITS.maxParticles - SCENE_LIMITS.minParticles))
      : scene === 'waves'
        ? Math.round(SCENE_LIMITS.waveSegments.min + d * (SCENE_LIMITS.waveSegments.max - SCENE_LIMITS.waveSegments.min))
        : 0
  return { scene, colors, count, speed: clamp(bg.speed, 0, 2), intensity: clamp(bg.intensity, 0, 1) }
}

export interface SceneRunInput {
  /** The active theme asks for a drawn scene. */
  wanted: boolean
  /** Settings switch "3D backgrounds". */
  scenesEnabled: boolean
  /** Master "Visual effects" switch. */
  effectsEnabled: boolean
  /** OS reduce-motion. */
  reduceMotion: boolean
  /** WebGL could not start, or a frame budget was blown for this theme. */
  failed: boolean
  /** Window hidden, minimised or in the tray. */
  hidden: boolean
  /** Window not focused and the pause-when-unfocused setting is on. */
  unfocusedPaused: boolean
  /** A page with the bill grid is showing (the layer is never behind the grid). */
  gridPage: boolean
}
export type SceneRunState = 'off' | 'paused' | 'run'

/** off = no canvas at all; paused = canvas kept but no frames drawn; run = animating. */
export function sceneRunState(i: SceneRunInput): SceneRunState {
  if (!i.wanted || !i.scenesEnabled || !i.effectsEnabled || i.reduceMotion || i.failed) return 'off'
  if (i.hidden || i.unfocusedPaused || i.gridPage) return 'paused'
  return 'run'
}

/** Pages that contain the bill grid: no 3D there (the grid is never themed with effects). Create, and the dev grid / perf pages. */
export function isGridPage(path: string): boolean {
  return path === '/create' || path === '/dev/grid' || path === '/dev/perf'
}

/** Frame cap: should a frame be drawn now? `lastMs` / `nowMs` are performance.now() values. */
export function shouldDrawFrame(lastMs: number, nowMs: number, maxFps: number = SCENE_LIMITS.maxFps): boolean {
  return nowMs - lastMs >= 1000 / maxFps - 1
}

/** Frame budget: true when too many recent frames were slow (the scene is then dropped for this theme). Input = recent frame durations in ms. */
export function budgetBlown(frameMs: readonly number[]): boolean {
  if (frameMs.length < SCENE_LIMITS.budgetWindow) return false
  const recent = frameMs.slice(-SCENE_LIMITS.budgetWindow)
  return recent.filter((t) => t > SCENE_LIMITS.slowFrameMs).length > SCENE_LIMITS.budgetMaxSlow
}
