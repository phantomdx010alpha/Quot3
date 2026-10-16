// Phase 167 (pure): the animation preset registry and the resolver that turns a validated theme's `effects` section plus the
// master switch / reduce-motion / hidden-window state into the attributes and variables the renderer sets on <html>.
// A theme only PICKS a preset by name with a speed and an intensity; every duration, distance and shadow is computed here from
// clamped numbers. Chrome only: the rules that use these live in renderer/styles/effects.css and never touch the grid or print.
import { EFFECT_INTENSITY, EFFECT_PRESETS, EFFECT_SPEED, type EffectSlot, type EffectSpec, type ThemeV2 } from './schemaV2'

/** Master switch setting (default ON). Off = today's look exactly (Phase 168 adds the Settings control). */
export const EFFECTS_ENABLED_KEY = 'effects.enabled'
export const EFFECTS_ENABLED_DEFAULT = true
/** Phase 168: pause effects while the window is not focused (default ON [A]). */
export const EFFECTS_PAUSE_UNFOCUSED_KEY = 'effects.pauseUnfocused'
export const EFFECTS_PAUSE_UNFOCUSED_DEFAULT = true
/** Phase 168: the owner's per-effect overrides, applied OVER the theme's own values. `{ [slot]: { enabled?: boolean; intensity?: 0..1 } }`. */
export const EFFECTS_OVERRIDES_KEY = 'effects.overrides'

export interface EffectOverride { enabled?: boolean; intensity?: number }
export type EffectOverrides = Partial<Record<EffectSlot, EffectOverride>>
/** Slots the owner can override, with plain-words labels (the Settings screen lists exactly these). */
export const EFFECT_OVERRIDE_SLOTS: ReadonlyArray<{ slot: EffectSlot; label: string; hint: string }> = [
  { slot: 'pageTransition', label: 'Page transitions', hint: 'A short fade when you move between pages.' },
  { slot: 'hoverMotion', label: 'Button hover and press motion', hint: 'Buttons lift, glow or shrink slightly under the mouse.' },
  { slot: 'accentGlow', label: 'Accent glow', hint: 'A soft glow around the main (accent) buttons.' },
  { slot: 'ambient', label: 'Slow background motion', hint: 'Very gentle movement on the side rail. Never on the bill grid.' }
]

/** Reads a stored overrides value defensively (anything unknown is dropped; intensity clamped). Never throws. */
export function sanitizeOverrides(raw: unknown): EffectOverrides {
  const out: EffectOverrides = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  for (const { slot } of EFFECT_OVERRIDE_SLOTS) {
    const v = (raw as Record<string, unknown>)[slot]
    if (typeof v !== 'object' || v === null || Array.isArray(v)) continue
    const o: EffectOverride = {}
    const e = (v as Record<string, unknown>).enabled
    const i = (v as Record<string, unknown>).intensity
    if (typeof e === 'boolean') o.enabled = e
    if (typeof i === 'number' && Number.isFinite(i)) o.intensity = Math.min(EFFECT_INTENSITY.max, Math.max(EFFECT_INTENSITY.min, i))
    if (o.enabled !== undefined || o.intensity !== undefined) out[slot] = o
  }
  return out
}

/** Applies the owner's overrides over a theme's effects (pure, returns a new object). An override can switch a slot the theme uses off or change its intensity; it never adds a slot the theme does not have. */
export function applyOverrides(effects: ThemeV2['effects'] | undefined, overrides: EffectOverrides | undefined): ThemeV2['effects'] | undefined {
  if (!effects || !overrides) return effects
  const out: NonNullable<ThemeV2['effects']> = { ...effects }
  for (const { slot } of EFFECT_OVERRIDE_SLOTS) {
    const o = overrides[slot]
    const cur = out[slot]
    if (!o || !cur) continue
    if (o.enabled === false) { delete out[slot]; continue }
    if (o.intensity !== undefined) out[slot] = { ...cur, intensity: o.intensity }
  }
  return out
}

export interface PresetInfo {
  label: string
  /** Duration in ms at speed 1. */
  baseMs: number
  /** Intensity used when the theme gives none. */
  defaultIntensity: number
}

/** Detailed parameters per slot / preset (names come from schemaV2.EFFECT_PRESETS; a test keeps the two in step). */
export const EFFECT_REGISTRY: Readonly<Record<Exclude<EffectSlot, 'accentGlow'>, Readonly<Record<string, PresetInfo>>>> = {
  pageTransition: {
    fade: { label: 'Fade', baseMs: 180, defaultIntensity: 0.5 },
    'fade-slide': { label: 'Fade and slide up', baseMs: 240, defaultIntensity: 0.5 },
    'zoom-fade': { label: 'Fade and zoom in', baseMs: 220, defaultIntensity: 0.5 }
  },
  hoverMotion: {
    lift: { label: 'Lift on hover', baseMs: 140, defaultIntensity: 0.5 },
    press: { label: 'Shrink on press', baseMs: 100, defaultIntensity: 0.5 },
    glow: { label: 'Glow on hover', baseMs: 160, defaultIntensity: 0.5 }
  },
  ambient: {
    breathe: { label: 'Slow pulse', baseMs: 6000, defaultIntensity: 0.4 },
    drift: { label: 'Slow drift', baseMs: 9000, defaultIntensity: 0.4 },
    shimmer: { label: 'Soft shimmer', baseMs: 7000, defaultIntensity: 0.4 }
  }
}
export const GLOW_DEFAULT_INTENSITY = 0.4
/** Ambient motion is capped so it stays subtle; hover distances are capped so nothing jumps. */
export const FX_LIMITS = { liftPx: 4, pressScale: 0.06, hoverGlowPx: 14, glowBlurPx: 20, glowSpreadPx: 2, ambientOpacity: 0.35, ambientMinMs: 1500 } as const

export interface FxState {
  /** The master switch (setting `effects.enabled`). */
  enabled: boolean
  /** OS / app reduce-motion preference: always wins over the theme. */
  reduceMotion: boolean
  /** The window is hidden or minimised (animations pause, nothing runs in the tray). */
  hidden: boolean
  /** Phase 168: the window has focus (absent = focused). */
  focused?: boolean
  /** Phase 168: pause while not focused (absent = the default, ON). */
  pauseUnfocused?: boolean
}

export interface ResolvedEffects {
  /** False when the switch is off or reduce-motion is on: nothing is applied at all. */
  active: boolean
  paused: boolean
  pageTransition: { preset: string; ms: number } | null
  hoverMotion: { preset: string; ms: number; amount: number } | null
  accentGlow: { intensity: number } | null
  ambient: { preset: string; ms: number; opacity: number } | null
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))
const round = (n: number, dp = 3): number => Math.round(n * 10 ** dp) / 10 ** dp

function pick(slot: Exclude<EffectSlot, 'accentGlow'>, spec: EffectSpec | undefined): { preset: string; info: PresetInfo; speed: number; intensity: number } | null {
  const preset = spec?.preset
  if (!preset || preset === 'none' || !EFFECT_PRESETS[slot].includes(preset)) return null
  const info = EFFECT_REGISTRY[slot][preset]
  if (!info) return null
  return {
    preset,
    info,
    speed: clamp(spec?.speed ?? 1, EFFECT_SPEED.min, EFFECT_SPEED.max),
    intensity: clamp(spec?.intensity ?? info.defaultIntensity, EFFECT_INTENSITY.min, EFFECT_INTENSITY.max)
  }
}

const NONE: ResolvedEffects = { active: false, paused: false, pageTransition: null, hoverMotion: null, accentGlow: null, ambient: null }

export function resolveEffects(effects: ThemeV2['effects'] | undefined, state: FxState): ResolvedEffects {
  if (!state.enabled || state.reduceMotion || !effects) return { ...NONE }
  const page = pick('pageTransition', effects.pageTransition)
  const hover = pick('hoverMotion', effects.hoverMotion)
  const amb = pick('ambient', effects.ambient)
  const glowRaw = effects.accentGlow?.intensity
  const glow = typeof glowRaw === 'number' ? clamp(glowRaw, EFFECT_INTENSITY.min, EFFECT_INTENSITY.max) : undefined
  const out: ResolvedEffects = {
    active: false,
    paused: state.hidden || ((state.pauseUnfocused ?? EFFECTS_PAUSE_UNFOCUSED_DEFAULT) && state.focused === false),
    pageTransition: page ? { preset: page.preset, ms: Math.round(page.info.baseMs / page.speed) } : null,
    hoverMotion: hover
      ? {
          preset: hover.preset,
          ms: Math.round(hover.info.baseMs / hover.speed),
          amount: round(
            hover.preset === 'lift' ? hover.intensity * FX_LIMITS.liftPx : hover.preset === 'press' ? hover.intensity * FX_LIMITS.pressScale : hover.intensity * FX_LIMITS.hoverGlowPx
          )
        }
      : null,
    accentGlow: glow !== undefined && glow > 0 ? { intensity: round(glow) } : null,
    ambient: amb ? { preset: amb.preset, ms: Math.max(FX_LIMITS.ambientMinMs, Math.round(amb.info.baseMs / amb.speed)), opacity: round(amb.intensity * FX_LIMITS.ambientOpacity) } : null
  }
  out.active = !!(out.pageTransition || out.hoverMotion || out.accentGlow || out.ambient)
  return out
}

/** `data-fx-*` attributes for <html> (absent key = that effect is off). */
export function fxAttributes(r: ResolvedEffects): Record<string, string> {
  const a: Record<string, string> = {}
  if (r.pageTransition) a['data-fx-page'] = r.pageTransition.preset
  if (r.hoverMotion) a['data-fx-hover'] = r.hoverMotion.preset
  if (r.accentGlow) a['data-fx-glow'] = 'on'
  if (r.ambient) a['data-fx-ambient'] = r.ambient.preset
  if (r.active && r.paused) a['data-fx-paused'] = 'on'
  return a
}

/** App-owned CSS variables for the effect rules (never theme text). */
export function fxVariables(r: ResolvedEffects): Record<string, string> {
  const v: Record<string, string> = {}
  if (r.pageTransition) v['--fx-page-dur'] = `${r.pageTransition.ms}ms`
  if (r.hoverMotion) {
    v['--fx-hover-dur'] = `${r.hoverMotion.ms}ms`
    v['--fx-hover-amt'] = String(r.hoverMotion.amount)
  }
  if (r.accentGlow) {
    const i = r.accentGlow.intensity
    // Sets the Phase 165 token so the rule is simply `box-shadow: var(--shadow-raised), var(--accent-glow)`.
    v['--accent-glow'] = `0 0 ${round(i * FX_LIMITS.glowBlurPx, 1)}px ${round(i * FX_LIMITS.glowSpreadPx, 1)}px var(--accent-soft)`
  }
  if (r.ambient) {
    v['--fx-ambient-dur'] = `${r.ambient.ms}ms`
    v['--fx-ambient-opacity'] = String(r.ambient.opacity)
  }
  return v
}
