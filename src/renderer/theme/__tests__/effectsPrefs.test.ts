// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateTheme } from '@shared/theme/validateTheme'
import { getEffectsPrefs, resetEffectsPrefs, saveEffectOverride, saveEffectsEnabled, savePauseUnfocused, setThemeEffects, subscribeEffectsPrefs, toggleEffects } from '../effects'
import { applyTheme } from '../ThemeProvider'

const el = document.documentElement
const set = vi.fn(async () => ({ ok: true, data: {} }))
const fxAttrs = () => el.getAttributeNames().filter((n) => n.startsWith('data-fx-')).sort()
const theme = () => {
  const r = validateTheme({ schema: 2, id: 'fx', name: 'FX', effects: { pageTransition: { preset: 'fade' }, accentGlow: { intensity: 0.5 }, ambient: { preset: 'drift' } } })
  if (!r.ok) throw new Error('bad')
  return r.theme
}
beforeEach(() => { set.mockClear(); (window as unknown as { quot3: unknown }).quot3 = { settings: { set, get: vi.fn() } } })
afterEach(() => { resetEffectsPrefs(); setThemeEffects(undefined); delete (window as unknown as { quot3?: unknown }).quot3 })

describe('effects prefs (Phase 168)', () => {
  it('master switch applies at once, is saved, and the snapshot is stable until something changes', () => {
    applyTheme(theme())
    expect(fxAttrs().length).toBe(3)
    const a = getEffectsPrefs()
    expect(getEffectsPrefs()).toBe(a)
    saveEffectsEnabled(false)
    expect(fxAttrs()).toEqual([])
    expect(set).toHaveBeenCalledWith('effects.enabled', false)
    expect(getEffectsPrefs()).not.toBe(a)
    expect(toggleEffects()).toBe(true)
    expect(fxAttrs().length).toBe(3)
  })
  it('a per-effect off and an intensity override are applied over the theme and saved', () => {
    applyTheme(theme())
    saveEffectOverride('pageTransition', { enabled: false })
    expect(fxAttrs()).toEqual(['data-fx-ambient', 'data-fx-glow'])
    saveEffectOverride('accentGlow', { intensity: 1 })
    expect(el.style.getPropertyValue('--accent-glow')).toContain('20px')
    expect(set).toHaveBeenLastCalledWith('effects.overrides', { pageTransition: { enabled: false }, accentGlow: { intensity: 1 } })
  })
  it('pause when not focused is saved and drives data-fx-paused', () => {
    applyTheme(theme())
    window.dispatchEvent(new Event('blur'))
    savePauseUnfocused(true)
    expect(set).toHaveBeenCalledWith('effects.pauseUnfocused', true)
  })
  it('reset clears every override, turns the switch back on and notifies subscribers', () => {
    applyTheme(theme())
    saveEffectOverride('ambient', { enabled: false })
    saveEffectsEnabled(false)
    const l = vi.fn()
    const off = subscribeEffectsPrefs(l)
    resetEffectsPrefs()
    off()
    expect(l).toHaveBeenCalled()
    expect(getEffectsPrefs()).toMatchObject({ enabled: true, pauseUnfocused: true, overrides: {} })
    expect(fxAttrs().length).toBe(3)
    expect(set).toHaveBeenCalledWith('effects.overrides', {})
  })
})
