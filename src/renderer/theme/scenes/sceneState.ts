import type { Quot3Bridge } from '@shared/ipc'
import type { ThemeV2 } from '@shared/theme/schemaV2'
import { resolveScene, SCENES_ENABLED_DEFAULT, SCENES_ENABLED_KEY, type ResolvedScene } from '@shared/theme/scenes'

/**
 * Phase 169: what the background layer needs to know, as ONE immutable snapshot (a new object only when something changed) read
 * with useSyncExternalStore: no store, no fresh object per selector call (Phase 92 rule). `failedKey` remembers a theme whose scene
 * failed (no WebGL / over budget) so it is not retried until the theme changes.
 */
export interface SceneSnapshot { readonly scene: ResolvedScene | null; readonly sceneKey: string; readonly scenesEnabled: boolean; readonly failedKey: string }
let snap: SceneSnapshot = { scene: null, sceneKey: '', scenesEnabled: SCENES_ENABLED_DEFAULT, failedKey: '' }
const listeners = new Set<() => void>()
const emit = (next: Partial<SceneSnapshot>): void => { snap = { ...snap, ...next }; for (const l of listeners) l() }
export const subscribeScene = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const getSceneSnapshot = (): SceneSnapshot => snap

const bridge = (): Quot3Bridge['settings'] | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { quot3?: { settings?: Quot3Bridge['settings'] } }).quot3?.settings)

/** Called by the theme applier with the validated background (undefined for built-ins and v1 themes = no scene). */
export function setThemeBackground(bg: ThemeV2['background'] | undefined): void {
  const scene = resolveScene(bg)
  const key = scene ? JSON.stringify(scene) : ''
  if (key === snap.sceneKey) return
  emit({ scene, sceneKey: key, failedKey: '' })
}
export function markSceneFailed(): void { emit({ failedKey: snap.sceneKey }) }
export function setScenesEnabled(on: boolean): void { if (on !== snap.scenesEnabled) emit({ scenesEnabled: on, failedKey: '' }) }
export function saveScenesEnabled(on: boolean): void {
  setScenesEnabled(on)
  try { void bridge()?.set(SCENES_ENABLED_KEY, on)?.catch(() => undefined) } catch { /* not saved this time */ }
}
export function initScenes(): void {
  const s = bridge()
  if (!s) return
  void s.get(SCENES_ENABLED_KEY).then((r) => { if (r.ok && typeof r.data.value === 'boolean') setScenesEnabled(r.data.value) }).catch(() => undefined)
}
