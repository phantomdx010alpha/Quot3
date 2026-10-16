// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { validateTheme } from '@shared/theme/validateTheme'
import { refreshEffects, setEffectsEnabled, setThemeEffects } from '../effects'
import { applyTheme } from '../ThemeProvider'

const el = document.documentElement
const theme = () => {
  const r = validateTheme({ schema: 2, id: 'fx', name: 'FX', effects: { pageTransition: { preset: 'fade' }, accentGlow: { intensity: 0.5 }, ambient: { preset: 'drift' } } })
  if (!r.ok) throw new Error('bad')
  return r.theme
}
const fxAttrs = () => el.getAttributeNames().filter((n) => n.startsWith('data-fx-'))
afterEach(() => { setEffectsEnabled(true); setThemeEffects(undefined) })

describe('renderer effects (Phase 167)', () => {
  it('applying a theme with effects sets attributes and variables; the next theme removes them all', () => {
    applyTheme(theme())
    expect(fxAttrs().sort()).toEqual(['data-fx-ambient', 'data-fx-glow', 'data-fx-page'])
    expect(el.style.getPropertyValue('--fx-page-dur')).toBe('180ms')
    expect(el.style.getPropertyValue('--accent-glow')).toContain('var(--accent-soft)')
    applyTheme({ id: 'paper', name: 'Paper', tokens: {}, builtin: true })
    expect(fxAttrs()).toEqual([])
    expect(el.style.getPropertyValue('--fx-page-dur')).toBe('')
    expect(el.style.getPropertyValue('--accent-glow')).toBe('')
  })
  it('the master switch removes everything and restores it', () => {
    applyTheme(theme())
    setEffectsEnabled(false)
    expect(fxAttrs()).toEqual([])
    expect(el.style.getPropertyValue('--accent-glow')).toBe('')
    setEffectsEnabled(true)
    expect(fxAttrs().length).toBe(3)
  })
  it('a v1 theme and a built-in never get effect attributes', () => {
    const v1 = validateTheme({ id: 'old', name: 'Old', tokens: { '--accent': '#fff' } })
    if (v1.ok) applyTheme(v1.theme)
    refreshEffects()
    expect(fxAttrs()).toEqual([])
  })
})
