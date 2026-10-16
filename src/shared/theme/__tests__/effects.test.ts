import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EFFECT_REGISTRY, EFFECTS_ENABLED_KEY, FX_LIMITS, fxAttributes, fxVariables, resolveEffects, type FxState } from '../effects'
import { EFFECT_PRESETS } from '../schemaV2'
import { validateTheme } from '../validateTheme'
import { checkTokenValue } from '../validateTheme'
import { SETTING_DEFAULTS } from '../../settings'

const on: FxState = { enabled: true, reduceMotion: false, hidden: false }
const fx = (effects: Record<string, unknown>) => {
  const r = validateTheme({ schema: 2, id: 't', name: 'T', effects })
  if (!r.ok) throw new Error(r.errors.join())
  return r.theme.v2!.effects
}

describe('effect registry', () => {
  it('has detail for exactly the preset names the schema allows', () => {
    for (const slot of ['pageTransition', 'hoverMotion', 'ambient'] as const) {
      expect(Object.keys(EFFECT_REGISTRY[slot]).sort()).toEqual(EFFECT_PRESETS[slot].filter((p) => p !== 'none').sort())
    }
  })
  it('the master switch defaults to ON as a known setting', () => {
    expect(SETTING_DEFAULTS[EFFECTS_ENABLED_KEY]).toBe(true)
  })
})

describe('resolveEffects', () => {
  const full = fx({ pageTransition: { preset: 'fade-slide', speed: 2 }, hoverMotion: { preset: 'lift', intensity: 1 }, accentGlow: { intensity: 0.5 }, ambient: { preset: 'breathe', speed: 3, intensity: 1 } })
  it('turns presets into durations and capped amounts', () => {
    const r = resolveEffects(full, on)
    expect(r.active).toBe(true)
    expect(r.pageTransition).toEqual({ preset: 'fade-slide', ms: 120 })
    expect(r.hoverMotion).toMatchObject({ preset: 'lift', amount: FX_LIMITS.liftPx })
    expect(r.ambient).toMatchObject({ ms: 2000, opacity: FX_LIMITS.ambientOpacity })
    expect(r.accentGlow).toEqual({ intensity: 0.5 })
  })
  it('master switch off and reduce-motion each turn everything off (nothing applied)', () => {
    for (const s of [{ ...on, enabled: false }, { ...on, reduceMotion: true }]) {
      const r = resolveEffects(full, s)
      expect(r.active).toBe(false)
      expect(fxAttributes(r)).toEqual({})
      expect(fxVariables(r)).toEqual({})
    }
  })
  it('no effects / none / zero glow = inactive; a hidden window marks the active effects paused', () => {
    expect(resolveEffects(undefined, on).active).toBe(false)
    expect(resolveEffects(fx({ pageTransition: { preset: 'none' }, accentGlow: { intensity: 0 } }), on).active).toBe(false)
    expect(fxAttributes(resolveEffects(full, { ...on, hidden: true }))['data-fx-paused']).toBe('on')
    expect(fxAttributes(resolveEffects(undefined, { ...on, hidden: true }))).toEqual({})
  })
  it('unknown presets fall back to none (validator) and hostile numbers are clamped (validator + resolver)', () => {
    const r = resolveEffects(fx({ pageTransition: { preset: 'explode' }, ambient: { preset: 'drift', speed: 999, intensity: 99 } }), on)
    expect(r.pageTransition).toBeNull()
    expect(r.ambient).toMatchObject({ ms: 3000, opacity: FX_LIMITS.ambientOpacity })
    const raw = resolveEffects({ hoverMotion: { preset: 'press', speed: -5, intensity: 50 } }, on)
    expect(raw.hoverMotion).toMatchObject({ amount: FX_LIMITS.pressScale, ms: 400 })
  })
  it('attributes and variables are app-built, safe values', () => {
    const r = resolveEffects(full, on)
    expect(fxAttributes(r)).toEqual({ 'data-fx-page': 'fade-slide', 'data-fx-hover': 'lift', 'data-fx-glow': 'on', 'data-fx-ambient': 'breathe' })
    for (const [k, v] of Object.entries(fxVariables(r))) {
      expect(k.startsWith('--fx-') || k === '--accent-glow', k).toBe(true)
      expect(checkTokenValue(v), `${k}=${v}`).toBeNull()
    }
  })
})

describe('effects.css touches chrome only', () => {
  const css = readFileSync(resolve(__dirname, '../../../renderer/styles/effects.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  // drop at-rule preludes (@keyframes / @media) and keyframe steps, then read each rule's selector list; commas inside :is( ) are not separators
  const flat = css.replace(/@[a-z-]+[^{]*\{/g, '{')
  const selectors = [...flat.matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim()).filter((s) => s.startsWith('html'))
  const parts = (s: string): string[] => s.replace(/:is\([^)]*\)/g, ':is()').split(',').map((p) => p.trim())
  it('every rule is scoped to an html[data-fx-...] attribute', () => {
    const rules = selectors.filter((s) => s.includes('data-fx'))
    expect(rules.length).toBeGreaterThan(8)
    for (const s of rules) expect(parts(s).every((p) => p.startsWith('html[data-fx-')), s).toBe(true)
  })
  it('no selector targets the grid, the Create page or print content (the only grid mention is the exclusion)', () => {
    for (const s of selectors) {
      const stripped = s.replace(/:not\(:has\(\.q3-grid\)\)/g, '')
      expect(/q3-gr|q3-create|grid|print|table/i.test(stripped), s).toBe(false)
    }
  })
  it('has no colour literals, url() or blur / backdrop-filter', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|url\s*\(|backdrop-filter|blur\(/)
  })
  it('turns off under reduce-motion and in print', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(css).toMatch(/@media print[\s\S]*animation: none !important/)
  })
})
