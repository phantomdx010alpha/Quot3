import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { themeInlineTokens, v2Preview, v2Summary, v2ToFileSections, v2ToTokens } from '../applyV2'
import { buildStarterTheme, starterIsValid, starterToJson } from '../starter'
import { checkTokenValue, validateTheme, type ThemeFile } from '../validateTheme'
import { isTokenName } from '../tokens'

const file = {
  schema: 2,
  id: 'aurora',
  name: 'Aurora',
  base: 'navy-ember',
  tokens: { '--accent': '#5fe0b8', '--radius-md': '3px' },
  gradients: { shell: { angle: 160, stops: [['#0b1220', 0], ['#10213d', 100]] }, accent: { kind: 'radial', stops: [['#5fe0b8', 0], ['#7db7ff', 100]] } },
  fonts: { ui: 'segoe-ui', grid: 'consolas' },
  shape: { radius: 'round', border: 'thick', shadow: 'flat' },
  effects: { accentGlow: { intensity: 0.4 } },
  background: { scene: 'particles', colors: ['#5fe0b8'] }
}
const theme = (): ThemeFile => {
  const r = validateTheme(file)
  if (!r.ok) throw new Error(r.errors.join())
  return r.theme
}

describe('v2ToTokens (Phase 166)', () => {
  it('maps gradients, fonts and shape to whitelisted, safe tokens', () => {
    const t = v2ToTokens(theme().v2)
    expect(t['--gradient-shell']).toBe('linear-gradient(160deg, #0b1220 0%, #10213d 100%)')
    expect(t['--gradient-accent']).toMatch(/^radial-gradient\(/)
    expect(t['--gradient-panel']).toBeUndefined()
    expect(t['--font-ui']).toContain('Segoe UI')
    expect(t['--font-grid']).toContain('Consolas')
    expect(t['--radius-lg']).toBe('24px')
    expect(t['--border-width']).toBe('3px')
    expect(t['--shadow-blur']).toBe('0px')
    for (const [k, v] of Object.entries(t)) {
      expect(isTokenName(k), k).toBe(true)
      expect(checkTokenValue(v), `${k}=${v}`).toBeNull()
      expect(v).not.toMatch(/url\s*\(/i)
    }
  })
  it('a v1 theme / no v2 gives nothing and the explicit tokens win over the sections', () => {
    expect(v2ToTokens(undefined)).toEqual({})
    const all = themeInlineTokens(theme())
    expect(all['--radius-md']).toBe('3px') // explicit token beats shape "round" (14px)
    expect(all['--radius-sm']).toBe('8px')
    expect(all['--accent']).toBe('#5fe0b8')
    const v1 = validateTheme({ id: 'x', name: 'X', tokens: { '--accent': '#fff' } })
    expect(v1.ok && themeInlineTokens(v1.theme)).toEqual({ '--accent': '#fff' })
  })
  it('preview and summary come from validated data only', () => {
    const p = v2Preview(theme())
    expect(p.shell).toMatch(/^linear-gradient/)
    expect(p.panel).toBeUndefined()
    expect(v2Summary(theme())).toEqual(['2 gradients', 'fonts', 'shape'])
    expect(v2Summary({})).toEqual([])
  })
})

describe('starter export keeps the new sections (Phase 166)', () => {
  it('a v2 theme exports as schema 2 with its sections, gradient tokens are not duplicated, and the result validates', () => {
    const t = theme()
    const s = buildStarterTheme({
      fromId: t.id, fromName: t.name, fromBase: t.base, builtin: false, takenIds: [], v2: t.v2,
      computed: { '--accent': '#5fe0b8', '--gradient-shell': 'linear-gradient(160deg, #0b1220 0%, #10213d 100%)', '--accent-glow': 'none' }
    })
    expect(s.schema).toBe(2)
    expect(Object.keys(s.tokens)).toEqual(['--accent'])
    const back = starterIsValid(s)
    expect(back?.v2?.gradients.shell?.stops).toHaveLength(2)
    expect(back?.v2?.fonts).toEqual({ ui: 'segoe-ui', grid: 'consolas' })
    expect(back?.v2?.shape).toEqual({ radius: 'round', border: 'thick', shadow: 'flat' })
    expect(v2ToFileSections(back?.v2)).toEqual(v2ToFileSections(t.v2))
    expect(starterToJson(s).endsWith('\n')).toBe(true)
  })
  it('a v1 / built-in export is exactly as before (no schema key)', () => {
    const s = buildStarterTheme({ fromId: 'paper', fromName: 'Paper', builtin: true, takenIds: [], computed: { '--accent': '#ba2f2f' } })
    expect(Object.keys(s)).toEqual(['id', 'name', 'base', 'tokens'])
  })
})

describe('chrome only: the grid and print never receive gradients or blur (design 3.4)', () => {
  const css = (n: string): string => readFileSync(resolve(__dirname, '../../../renderer/styles', n), 'utf8')
  it('grid.css has no gradient / glass / backdrop-filter / bg-image references', () => {
    const g = css('grid.css')
    for (const bad of ['--gradient-', '--glass-blur', '--surface-glass', '--bg-image', 'backdrop-filter', 'linear-gradient', 'radial-gradient']) expect(g.includes(bad), bad).toBe(false)
  })
  it('only the shell, rail and primary button use the gradient tokens in ui.css', () => {
    const lines = css('ui.css').split('\n').filter((l) => l.includes('var(--gradient-'))
    expect(lines.length).toBe(3)
    expect(lines.some((l) => l.includes('.q3-shell'))).toBe(true)
    expect(lines.some((l) => l.includes('.q3-btn--primary'))).toBe(true)
  })
  it('tokens.css defaults every gradient token to none', () => {
    const t = css('tokens.css')
    for (const n of ['--gradient-shell', '--gradient-panel', '--gradient-accent']) expect(t).toContain(`${n}: none;`)
  })
})
