import { describe, expect, it } from 'vitest'
import { buildStarterTheme, starterIsValid, uniqueThemeId } from '../starter'

describe('starter theme (Phase 49)', () => {
  it('keeps whitelisted safe tokens, drops unknown / hostile / empty ones, and passes validateTheme', () => {
    const s = buildStarterTheme({ fromId: 'navy-ember', fromName: 'Navy Ember', builtin: true, takenIds: ['navy-ember', 'paper'],
      computed: { '--accent': ' #FF7B7B ', '--row-height': '26px', '--bogus': '1', '--surface-base': 'url(x)', '--text-muted': '' } })
    expect(s).toMatchObject({ id: 'navy-ember-copy', name: 'Navy Ember copy', base: 'navy-ember' })
    expect(Object.keys(s.tokens).sort()).toEqual(['--accent', '--row-height'])
    expect(starterIsValid(s)).not.toBeNull()
  })
  it('a custom theme exports onto its built-in base (default if unknown)', () => {
    const t = (fromBase?: string) => buildStarterTheme({ fromId: 'mine', fromName: 'Mine', fromBase, builtin: false, takenIds: [], computed: { '--accent': '#fff' } }).base
    expect(t('paper')).toBe('paper')
    expect(t(undefined)).toBe('navy-ember')
  })
  it('ids stay unique, short and never built-in', () => {
    expect(uniqueThemeId('navy-ember', ['navy-ember-copy', 'navy-ember-copy-2'])).toBe('navy-ember-copy-3')
    expect(uniqueThemeId('paper', [])).toBe('paper-copy')
    expect(uniqueThemeId('x'.repeat(60), []).length).toBeLessThanOrEqual(40)
  })
})
