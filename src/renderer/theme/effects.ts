import type { Quot3Bridge } from '@shared/ipc'
import type { ThemeV2 } from '@shared/theme/schemaV2'
import {
  applyOverrides, EFFECTS_ENABLED_DEFAULT, EFFECTS_ENABLED_KEY, EFFECTS_OVERRIDES_KEY, EFFECTS_PAUSE_UNFOCUSED_DEFAULT, EFFECTS_PAUSE_UNFOCUSED_KEY,
  fxAttributes, fxVariables, resolveEffects, sanitizeOverrides, type EffectOverride, type EffectOverrides, type FxState
} from '@shared/theme/effects'
import type { EffectSlot } from '@shared/theme/schemaV2'
import { SCENES_ENABLED_DEFAULT } from '@shared/theme/scenes'
import { saveScenesEnabled } from './scenes/sceneState'

/**
 * Phase 167 - applies the active theme's animation presets to <html> (attributes + app-owned variables, set through the DOM API,
 * never string-built CSS). State is module-level on purpose (no store, nothing to subscribe to): the rules in styles/effects.css
 * react to the attributes. Chrome only; nothing here runs on the keystroke path.
 */
const state: FxState = { enabled: EFFECTS_ENABLED_DEFAULT, reduceMotion: false, hidden: false, focused: true, pauseUnfocused: EFFECTS_PAUSE_UNFOCUSED_DEFAULT }
let overrides: EffectOverrides = {}
let current: ThemeV2['effects'] | undefined
let setAttrs: string[] = []
let setVars: string[] = []
let wired = false

/** Re-resolves and re-applies everything (cheap; called on theme change and on each state change). */
export function refreshEffects(): void {
  const el = document.documentElement
  for (const a of setAttrs) el.removeAttribute(a)
  for (const v of setVars) el.style.removeProperty(v)
  const r = resolveEffects(applyOverrides(current, overrides), state)
  const attrs = fxAttributes(r)
  const vars = fxVariables(r)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v)
  setAttrs = Object.keys(attrs)
  setVars = Object.keys(vars)
}

/** Called by the theme applier with the theme's validated `effects` (undefined for built-ins and v1 themes = none). */
export function setThemeEffects(effects: ThemeV2['effects'] | undefined): void {
  current = effects
  refreshEffects()
}

/** The master switch (applies only; `saveEffectsEnabled` also persists). */
export function setEffectsEnabled(enabled: boolean): void {
  state.enabled = enabled
  publish()
  refreshEffects()
}
export const getEffectsEnabled = (): boolean => state.enabled

/**
 * Phase 168: the owner's effect settings as one immutable snapshot (a new object only when something changed), so the Settings
 * screen can read it with useSyncExternalStore without ever selecting a fresh object (Phase 92 selector rule).
 */
export interface EffectsPrefs { readonly enabled: boolean; readonly pauseUnfocused: boolean; readonly overrides: Readonly<EffectOverrides> }
let snapshot: EffectsPrefs = { enabled: state.enabled, pauseUnfocused: EFFECTS_PAUSE_UNFOCUSED_DEFAULT, overrides }
const listeners = new Set<() => void>()
function publish(): void {
  snapshot = { enabled: state.enabled, pauseUnfocused: state.pauseUnfocused ?? EFFECTS_PAUSE_UNFOCUSED_DEFAULT, overrides }
  for (const l of listeners) l()
}
export const subscribeEffectsPrefs = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const getEffectsPrefs = (): EffectsPrefs => snapshot

const settingsBridge = (): Quot3Bridge['settings'] | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { quot3?: { settings?: Quot3Bridge['settings'] } }).quot3?.settings)
function persist(key: string, value: unknown): void {
  try { void settingsBridge()?.set(key, value)?.catch(() => undefined) } catch { /* not saved this time; the change still applies for this session */ }
}

/** Master switch from Settings or the shortcut: applies at once and saves. */
export function saveEffectsEnabled(enabled: boolean): void { setEffectsEnabled(enabled); persist(EFFECTS_ENABLED_KEY, enabled) }
export function toggleEffects(): boolean { saveEffectsEnabled(!state.enabled); return state.enabled }
export function savePauseUnfocused(on: boolean): void { state.pauseUnfocused = on; publish(); refreshEffects(); persist(EFFECTS_PAUSE_UNFOCUSED_KEY, on) }
/** Changes one effect's override (merged with what is there), applies and saves. */
export function saveEffectOverride(slot: EffectSlot, patch: EffectOverride): void {
  overrides = sanitizeOverrides({ ...overrides, [slot]: { ...overrides[slot], ...patch } })
  publish(); refreshEffects(); persist(EFFECTS_OVERRIDES_KEY, overrides)
}
/** Reset: every override cleared, master switch back on, pause-when-unfocused back to its default. The theme's own values apply again. */
export function resetEffectsPrefs(): void {
  overrides = {}
  state.enabled = EFFECTS_ENABLED_DEFAULT
  state.pauseUnfocused = EFFECTS_PAUSE_UNFOCUSED_DEFAULT
  publish(); refreshEffects()
  saveScenesEnabled(SCENES_ENABLED_DEFAULT)
  persist(EFFECTS_OVERRIDES_KEY, {}); persist(EFFECTS_ENABLED_KEY, EFFECTS_ENABLED_DEFAULT); persist(EFFECTS_PAUSE_UNFOCUSED_KEY, EFFECTS_PAUSE_UNFOCUSED_DEFAULT)
}

/** Wires reduce-motion and window visibility once, and reads the saved master switch. Safe to call repeatedly; no-ops without a DOM API. */
export function initEffects(): void {
  if (wired || typeof document === 'undefined') return
  wired = true
  try {
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
    if (mq) {
      state.reduceMotion = mq.matches
      mq.addEventListener?.('change', (e) => { state.reduceMotion = e.matches; refreshEffects() })
    }
  } catch { /* reduce-motion unknown: effects stay governed by the switch */ }
  state.hidden = document.visibilityState === 'hidden'
  document.addEventListener('visibilitychange', () => { state.hidden = document.visibilityState === 'hidden'; refreshEffects() })
  state.focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true
  window.addEventListener('focus', () => { state.focused = true; refreshEffects() })
  window.addEventListener('blur', () => { state.focused = false; refreshEffects() })
  const settings = settingsBridge()
  if (settings) {
    void settings.get(EFFECTS_ENABLED_KEY).then((r) => {
      if (r.ok && typeof r.data.value === 'boolean') setEffectsEnabled(r.data.value)
    }).catch(() => undefined)
    void settings.get(EFFECTS_PAUSE_UNFOCUSED_KEY).then((r) => {
      if (r.ok && typeof r.data.value === 'boolean') { state.pauseUnfocused = r.data.value; publish(); refreshEffects() }
    }).catch(() => undefined)
    void settings.get(EFFECTS_OVERRIDES_KEY).then((r) => {
      if (r.ok) { overrides = sanitizeOverrides(r.data.value); publish(); refreshEffects() }
    }).catch(() => undefined)
  }
  refreshEffects()
}
