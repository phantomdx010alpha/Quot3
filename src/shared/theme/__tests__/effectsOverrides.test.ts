import { describe, expect, it } from 'vitest'
import { SETTING_DEFAULTS } from '../../settings'
import { ACTIONS, SHORTCUTS } from '../../shortcuts'
import { applyOverrides, EFFECT_OVERRIDE_SLOTS, EFFECTS_OVERRIDES_KEY, EFFECTS_PAUSE_UNFOCUSED_KEY, resolveEffects, sanitizeOverrides, type FxState } from '../effects'
import { EFFECT_SLOTS, type ThemeV2 } from '../schemaV2'

const fx: NonNullable<ThemeV2['effects']> = { pageTransition: { preset: 'fade', intensity: 0.5 }, accentGlow: { intensity: 0.6 }, ambient: { preset: 'drift', intensity: 0.4 } }
const st: FxState = { enabled: true, reduceMotion: false, hidden: false }

describe('effect overrides (Phase 168)', () => {
  it('defaults: pause-when-unfocused ON, no overrides', () => {
    expect(SETTING_DEFAULTS[EFFECTS_PAUSE_UNFOCUSED_KEY]).toBe(true)
    expect(SETTING_DEFAULTS[EFFECTS_OVERRIDES_KEY]).toEqual({})
  })
  it('the Settings list covers every effect slot', () => {
    expect(EFFECT_OVERRIDE_SLOTS.map((s) => s.slot).sort()).toEqual([...EFFECT_SLOTS].sort())
  })
  it('sanitize drops junk and clamps intensity', () => {
    expect(sanitizeOverrides(null)).toEqual({})
    expect(sanitizeOverrides([1])).toEqual({})
    expect(sanitizeOverrides({ ambient: { enabled: 'yes', intensity: 9 }, bogus: { enabled: false }, hoverMotion: { intensity: NaN } })).toEqual({ ambient: { intensity: 1 } })
    expect(sanitizeOverrides({ pageTransition: { enabled: false, intensity: -3 } })).toEqual({ pageTransition: { enabled: false, intensity: 0 } })
  })
  it('an override switches a slot off or changes its intensity, over the theme value', () => {
    const out = applyOverrides(fx, { pageTransition: { enabled: false }, accentGlow: { intensity: 0.2 } })!
    expect(out.pageTransition).toBeUndefined()
    expect(out.accentGlow).toEqual({ intensity: 0.2 })
    expect(out.ambient).toEqual(fx.ambient)
    expect(fx.pageTransition).toBeDefined() // input not mutated
    expect(resolveEffects(out, st).accentGlow?.intensity).toBe(0.2)
  })
  it('an override never adds a slot the theme does not have; none = unchanged', () => {
    expect(applyOverrides({ ambient: fx.ambient }, { hoverMotion: { intensity: 1 } })).toEqual({ ambient: fx.ambient })
    expect(applyOverrides(undefined, { ambient: { intensity: 1 } })).toBeUndefined()
    expect(applyOverrides(fx, undefined)).toBe(fx)
  })
  it('pause when not focused follows the setting; visible and focused is never paused', () => {
    expect(resolveEffects(fx, { ...st, focused: false, pauseUnfocused: true }).paused).toBe(true)
    expect(resolveEffects(fx, { ...st, focused: false, pauseUnfocused: false }).paused).toBe(false)
    expect(resolveEffects(fx, { ...st, focused: true }).paused).toBe(false)
    expect(resolveEffects(fx, { ...st, hidden: true, pauseUnfocused: false }).paused).toBe(true)
    expect(resolveEffects(fx, st).paused).toBe(false) // old 3-field state still means focused
  })
  it('the toggle is registered as an action and a shortcut, and its key is unique', () => {
    expect(ACTIONS.some((a) => a.id === 'effects.toggle')).toBe(true)
    const s = SHORTCUTS.find((x) => x.id === 'effects.toggle')!
    expect(s.action).toBe('effects.toggle')
    expect(SHORTCUTS.filter((x) => x.keys === s.keys && x.scope === s.scope)).toHaveLength(1)
  })
})
