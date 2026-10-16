// Themes 2.0 (Milestone 16, Phase 165): schema v2 sections, pure. A theme is DATA only: a v2 file PICKS built-in
// presets / scenes by name and gives validated numbers and colours. Nothing here (or in a theme file) can execute.
// Spec: docs/MILESTONE16_DESIGN.md, docs/design/DESIGN_TOKENS.md (schema v2), docs/THEME_CREATION_GUIDE.md section 8.
import { checkTokenValue } from './validateTheme'

export const THEME_SCHEMA_VERSION = 2

// ---------- registries (names are owned by the app; Phases 167 / 169 add the parameter detail) ----------
export const GRADIENT_SLOTS = ['shell', 'panel', 'accent'] as const
export type GradientSlot = (typeof GRADIENT_SLOTS)[number]
/** Slot -> CSS custom property the renderer sets (Phase 166). Chrome only; never the grid or print. */
export const GRADIENT_TOKEN: Readonly<Record<GradientSlot, string>> = {
  shell: '--gradient-shell',
  panel: '--gradient-panel',
  accent: '--gradient-accent'
}

/** Font choices a theme may name [A]: system-safe stacks only, no font files, no remote fonts. Print is never themed. */
export const FONT_STACKS: Readonly<Record<string, string>> = {
  system: "system-ui, 'Segoe UI', sans-serif",
  'segoe-ui': "'Segoe UI', system-ui, sans-serif",
  calibri: "Calibri, 'Segoe UI', sans-serif",
  arial: 'Arial, Helvetica, sans-serif',
  verdana: 'Verdana, Geneva, sans-serif',
  tahoma: 'Tahoma, Geneva, sans-serif',
  trebuchet: "'Trebuchet MS', 'Segoe UI', sans-serif",
  georgia: 'Georgia, Cambria, serif',
  cambria: 'Cambria, Georgia, serif',
  consolas: "Consolas, 'Cascadia Mono', monospace",
  'cascadia-mono': "'Cascadia Mono', Consolas, monospace",
  'courier-new': "'Courier New', Courier, monospace"
}
export const FONT_NAMES: readonly string[] = Object.keys(FONT_STACKS)
export const FONT_SLOTS = ['ui', 'grid'] as const
export type FontSlot = (typeof FONT_SLOTS)[number]
export const FONT_TOKEN: Readonly<Record<FontSlot, string>> = { ui: '--font-ui', grid: '--font-grid' }

export const SHAPE_RADIUS = ['sharp', 'soft', 'round'] as const
export const SHAPE_BORDER = ['none', 'thin', 'normal', 'thick'] as const
export const SHAPE_SHADOW = ['flat', 'soft', 'strong'] as const
/** Preset -> token overrides (values are inside the existing CLAMPS ranges). */
export const SHAPE_RADIUS_TOKENS: Readonly<Record<(typeof SHAPE_RADIUS)[number], Record<string, string>>> = {
  sharp: { '--radius-sm': '0px', '--radius-md': '2px', '--radius-lg': '4px' },
  soft: { '--radius-sm': '4px', '--radius-md': '8px', '--radius-lg': '14px' },
  round: { '--radius-sm': '8px', '--radius-md': '14px', '--radius-lg': '24px' }
}
export const SHAPE_BORDER_TOKENS: Readonly<Record<(typeof SHAPE_BORDER)[number], Record<string, string>>> = {
  none: { '--border-width': '0px' },
  thin: { '--border-width': '1px' },
  normal: { '--border-width': '2px' },
  thick: { '--border-width': '3px' }
}
export const SHAPE_SHADOW_TOKENS: Readonly<Record<(typeof SHAPE_SHADOW)[number], Record<string, string>>> = {
  flat: { '--shadow-dist': '0px', '--shadow-blur': '0px' },
  soft: { '--shadow-dist': '3px', '--shadow-blur': '8px' },
  strong: { '--shadow-dist': '6px', '--shadow-blur': '16px' }
}

export const EFFECT_SLOTS = ['pageTransition', 'hoverMotion', 'accentGlow', 'ambient'] as const
export type EffectSlot = (typeof EFFECT_SLOTS)[number]
/** Preset names per slot ('none' always allowed). accentGlow has no preset: intensity only. Phase 167 owns parameters. */
export const EFFECT_PRESETS: Readonly<Record<EffectSlot, readonly string[]>> = {
  pageTransition: ['none', 'fade', 'fade-slide', 'zoom-fade'],
  hoverMotion: ['none', 'lift', 'press', 'glow'],
  accentGlow: [],
  ambient: ['none', 'breathe', 'drift', 'shimmer']
}
export const EFFECT_SPEED = { min: 0.25, max: 3 } as const
export const EFFECT_INTENSITY = { min: 0, max: 1 } as const

/** Scene names a theme may pick (Phase 169 builds them). A name outside this list = no background + a warning. */
export const SCENE_NAMES: readonly string[] = ['none', 'particles', 'waves', 'gradient-mesh']
export const SCENE_COLORS_MAX = 4
export const SCENE_DENSITY = { min: 0, max: 1 } as const
export const SCENE_SPEED = { min: 0, max: 2 } as const
export const SCENE_INTENSITY = { min: 0, max: 1 } as const

export const GRADIENT_STOPS = { min: 2, max: 6 } as const

// ---------- validated output types ----------
export interface GradientSpec {
  kind: 'linear' | 'radial'
  angle: number
  stops: Array<{ color: string; at: number }>
}
export interface EffectSpec {
  preset?: string
  speed?: number
  intensity?: number
}
export interface BackgroundSpec {
  scene: string
  colors: string[]
  density: number
  speed: number
  intensity: number
}
export interface ThemeV2 {
  gradients: Partial<Record<GradientSlot, GradientSpec>>
  fonts: Partial<Record<FontSlot, string>>
  shape: { radius?: string; border?: string; shadow?: string }
  effects: Partial<Record<EffectSlot, EffectSpec>>
  background?: BackgroundSpec
}

export interface V2Result {
  v2: ThemeV2
  errors: string[]
  warnings: string[]
}

// ---------- helpers ----------
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGBA_RE = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i
const short = (s: string): string => JSON.stringify(s.slice(0, 40))

/** A colour a theme may use in v2 sections: hex or rgb()/rgba() only. Returns the normalised colour or null. */
export function normaliseColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (checkTokenValue(v) !== null) return null
  if (HEX_RE.test(v)) return v.toLowerCase()
  const m = RGBA_RE.exec(v)
  if (!m) return null
  const ch = [m[1], m[2], m[3]].map(Number)
  if (ch.some((n) => n > 255)) return null
  if (m[4] !== undefined && (Number(m[4]) > 1 || Number.isNaN(Number(m[4])))) return null
  return m[4] === undefined ? `rgb(${ch.join(', ')})` : `rgba(${ch.join(', ')}, ${Number(m[4])})`
}

/** Clamp a number into [min, max]; adds a warning when it had to move. Returns null when not a finite number. */
function num(value: unknown, min: number, max: number, label: string, warnings: string[]): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const c = Math.min(max, Math.max(min, value))
  if (c !== value) warnings.push(`${label} clamped from ${value} to ${c}`)
  return c
}

function warnUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string, warnings: string[]): void {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) warnings.push(`unknown key ${short(k)} in ${where} ignored`)
}

/** Reject any string a hostile file could use to smuggle code (url(), expression, braces ...). Returns the reason or null. */
function hostile(value: string): string | null {
  return checkTokenValue(value)
}

/** The CSS a validated gradient compiles to (the renderer sets it on a --gradient-* token; Phase 166). Never contains url(). */
export function gradientToCss(g: GradientSpec): string {
  const stops = g.stops.map((s) => `${s.color} ${s.at}%`).join(', ')
  return g.kind === 'radial' ? `radial-gradient(circle at 50% 0%, ${stops})` : `linear-gradient(${g.angle}deg, ${stops})`
}

// ---------- section validators ----------
function readGradients(raw: unknown, errors: string[], warnings: string[]): ThemeV2['gradients'] {
  const out: ThemeV2['gradients'] = {}
  if (!isObj(raw)) {
    errors.push('"gradients" must be an object')
    return out
  }
  for (const [slot, g] of Object.entries(raw)) {
    if (!(GRADIENT_SLOTS as readonly string[]).includes(slot)) {
      warnings.push(`unknown gradient ${short(slot)} ignored (use ${GRADIENT_SLOTS.join(', ')})`)
      continue
    }
    const label = `gradients.${slot}`
    if (!isObj(g)) {
      errors.push(`${label} must be an object`)
      continue
    }
    warnUnknownKeys(g, ['kind', 'angle', 'stops'], label, warnings)
    const kind = g['kind'] === undefined ? 'linear' : g['kind']
    if (kind !== 'linear' && kind !== 'radial') {
      errors.push(`${label}.kind must be "linear" or "radial"`)
      continue
    }
    const angle = g['angle'] === undefined ? 180 : num(g['angle'], 0, 360, `${label}.angle`, warnings)
    if (angle === null) {
      errors.push(`${label}.angle must be a number`)
      continue
    }
    const stopsRaw = g['stops']
    if (!Array.isArray(stopsRaw) || stopsRaw.length < GRADIENT_STOPS.min || stopsRaw.length > GRADIENT_STOPS.max) {
      errors.push(`${label}.stops must be a list of ${GRADIENT_STOPS.min}-${GRADIENT_STOPS.max} [colour, position] pairs`)
      continue
    }
    const stops: GradientSpec['stops'] = []
    let bad = false
    for (const [i, s] of stopsRaw.entries()) {
      if (!Array.isArray(s) || s.length !== 2) {
        errors.push(`${label}.stops[${i}] must be [colour, position 0-100]`)
        bad = true
        continue
      }
      if (typeof s[0] === 'string' && hostile(s[0])) {
        errors.push(`${label}.stops[${i}]: colour ${hostile(s[0])}`)
        bad = true
        continue
      }
      const color = normaliseColor(s[0])
      const at = num(s[1], 0, 100, `${label}.stops[${i}] position`, warnings)
      if (color === null || at === null) {
        errors.push(`${label}.stops[${i}] needs a hex or rgba() colour and a position 0-100`)
        bad = true
        continue
      }
      stops.push({ color, at })
    }
    if (bad) continue
    stops.sort((a, b) => a.at - b.at)
    out[slot as GradientSlot] = { kind, angle, stops }
  }
  return out
}

function readFonts(raw: unknown, errors: string[], warnings: string[]): ThemeV2['fonts'] {
  const out: ThemeV2['fonts'] = {}
  if (!isObj(raw)) {
    errors.push('"fonts" must be an object')
    return out
  }
  for (const [slot, f] of Object.entries(raw)) {
    if (!(FONT_SLOTS as readonly string[]).includes(slot)) {
      warnings.push(`unknown font slot ${short(slot)} ignored (use ${FONT_SLOTS.join(', ')}; print is never themed)`)
      continue
    }
    if (typeof f !== 'string') {
      errors.push(`fonts.${slot} must be a font name`)
      continue
    }
    const bad = hostile(f)
    if (bad) {
      errors.push(`fonts.${slot}: ${bad}`)
      continue
    }
    const key = f.trim().toLowerCase()
    if (!FONT_NAMES.includes(key)) {
      warnings.push(`fonts.${slot}: unknown font ${short(f)} ignored (the base font is kept)`)
      continue
    }
    out[slot as FontSlot] = key
  }
  return out
}

function readChoice(raw: Record<string, unknown>, key: string, allowed: readonly string[], errors: string[], warnings: string[]): string | undefined {
  const v = raw[key]
  if (v === undefined) return undefined
  if (typeof v !== 'string') {
    errors.push(`shape.${key} must be one of: ${allowed.join(', ')}`)
    return undefined
  }
  const bad = hostile(v)
  if (bad) {
    errors.push(`shape.${key}: ${bad}`)
    return undefined
  }
  if (!allowed.includes(v)) {
    warnings.push(`shape.${key}: unknown value ${short(v)} ignored (use ${allowed.join(', ')})`)
    return undefined
  }
  return v
}

function readShape(raw: unknown, errors: string[], warnings: string[]): ThemeV2['shape'] {
  if (!isObj(raw)) {
    errors.push('"shape" must be an object')
    return {}
  }
  warnUnknownKeys(raw, ['radius', 'border', 'shadow'], 'shape', warnings)
  const out: ThemeV2['shape'] = {}
  const radius = readChoice(raw, 'radius', SHAPE_RADIUS, errors, warnings)
  const border = readChoice(raw, 'border', SHAPE_BORDER, errors, warnings)
  const shadow = readChoice(raw, 'shadow', SHAPE_SHADOW, errors, warnings)
  if (radius) out.radius = radius
  if (border) out.border = border
  if (shadow) out.shadow = shadow
  return out
}

function readEffects(raw: unknown, errors: string[], warnings: string[]): ThemeV2['effects'] {
  const out: ThemeV2['effects'] = {}
  if (!isObj(raw)) {
    errors.push('"effects" must be an object')
    return out
  }
  for (const [slot, e] of Object.entries(raw)) {
    if (!(EFFECT_SLOTS as readonly string[]).includes(slot)) {
      warnings.push(`unknown effect ${short(slot)} ignored (use ${EFFECT_SLOTS.join(', ')})`)
      continue
    }
    const label = `effects.${slot}`
    if (!isObj(e)) {
      errors.push(`${label} must be an object`)
      continue
    }
    warnUnknownKeys(e, ['preset', 'speed', 'intensity'], label, warnings)
    const spec: EffectSpec = {}
    let skip = false
    if (e['preset'] !== undefined) {
      const p = e['preset']
      if (typeof p !== 'string') {
        errors.push(`${label}.preset must be a preset name`)
        continue
      }
      const bad = hostile(p)
      if (bad) {
        errors.push(`${label}.preset: ${bad}`)
        continue
      }
      const allowed = EFFECT_PRESETS[slot as EffectSlot]
      if (allowed.length === 0) warnings.push(`${label} has no presets; "preset" ignored`)
      else if (!allowed.includes(p)) {
        warnings.push(`${label}: unknown preset ${short(p)}, using "none" (use ${allowed.join(', ')})`)
        skip = true
        spec.preset = 'none'
      } else spec.preset = p
    }
    for (const [k, range] of [['speed', EFFECT_SPEED], ['intensity', EFFECT_INTENSITY]] as const) {
      if (e[k] === undefined) continue
      const n = num(e[k], range.min, range.max, `${label}.${k}`, warnings)
      if (n === null) errors.push(`${label}.${k} must be a number`)
      else if (!skip) spec[k] = n
    }
    out[slot as EffectSlot] = spec
  }
  return out
}

function readBackground(raw: unknown, errors: string[], warnings: string[]): BackgroundSpec | undefined {
  if (!isObj(raw)) {
    errors.push('"background" must be an object')
    return undefined
  }
  warnUnknownKeys(raw, ['scene', 'colors', 'density', 'speed', 'intensity'], 'background', warnings)
  const scene = raw['scene']
  if (typeof scene !== 'string') {
    errors.push('background.scene must be a scene name')
    return undefined
  }
  const bad = hostile(scene)
  if (bad) {
    errors.push(`background.scene: ${bad}`)
    return undefined
  }
  if (!SCENE_NAMES.includes(scene)) {
    warnings.push(`background.scene: unknown scene ${short(scene)}, no background will be shown (use ${SCENE_NAMES.join(', ')})`)
    return undefined
  }
  const colors: string[] = []
  if (raw['colors'] !== undefined) {
    if (!Array.isArray(raw['colors']) || raw['colors'].length > SCENE_COLORS_MAX) {
      errors.push(`background.colors must be a list of up to ${SCENE_COLORS_MAX} colours`)
      return undefined
    }
    for (const [i, c] of raw['colors'].entries()) {
      if (typeof c === 'string' && hostile(c)) {
        errors.push(`background.colors[${i}]: ${hostile(c)}`)
        return undefined
      }
      const n = normaliseColor(c)
      if (n === null) {
        errors.push(`background.colors[${i}] must be a hex or rgba() colour`)
        return undefined
      }
      colors.push(n)
    }
  }
  const read = (k: 'density' | 'speed' | 'intensity', r: { min: number; max: number }, dflt: number): number | undefined => {
    if (raw[k] === undefined) return dflt
    const n = num(raw[k], r.min, r.max, `background.${k}`, warnings)
    if (n === null) {
      errors.push(`background.${k} must be a number`)
      return undefined
    }
    return n
  }
  const density = read('density', SCENE_DENSITY, 0.5)
  const speed = read('speed', SCENE_SPEED, 0.3)
  const intensity = read('intensity', SCENE_INTENSITY, 0.5)
  if (density === undefined || speed === undefined || intensity === undefined) return undefined
  return { scene, colors, density, speed, intensity }
}

/** Keys a schema-2 file may carry at the top level. */
export const V2_TOP_KEYS = ['schema', 'id', 'name', 'base', 'tokens', 'gradients', 'fonts', 'shape', 'effects', 'background'] as const

/**
 * Validate the schema-2 sections of an already envelope-checked theme object (pure).
 * Hostile or malformed values -> `errors` (the whole file is rejected by validateTheme); unknown names and
 * out-of-range numbers -> `warnings` (dropped / clamped). Nothing returned can execute.
 */
export function validateV2Sections(obj: Record<string, unknown>): V2Result {
  const errors: string[] = []
  const warnings: string[] = []
  warnUnknownKeys(obj, V2_TOP_KEYS, 'the theme', warnings)
  const v2: ThemeV2 = { gradients: {}, fonts: {}, shape: {}, effects: {} }
  if (obj['gradients'] !== undefined) v2.gradients = readGradients(obj['gradients'], errors, warnings)
  if (obj['fonts'] !== undefined) v2.fonts = readFonts(obj['fonts'], errors, warnings)
  if (obj['shape'] !== undefined) v2.shape = readShape(obj['shape'], errors, warnings)
  if (obj['effects'] !== undefined) v2.effects = readEffects(obj['effects'], errors, warnings)
  if (obj['background'] !== undefined) {
    const bg = readBackground(obj['background'], errors, warnings)
    if (bg) v2.background = bg
  }
  return { v2, errors, warnings }
}
