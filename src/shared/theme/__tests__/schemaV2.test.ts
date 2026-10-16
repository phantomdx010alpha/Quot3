import { describe, expect, it } from 'vitest'
import { validateTheme } from '../validateTheme'
import { gradientToCss, normaliseColor, SCENE_NAMES } from '../schemaV2'
import { TOKEN_NAMES } from '../tokens'

const v1 = { id: 'my-theme', name: 'My Theme', base: 'navy-ember', tokens: { '--accent': '#FFB347' } }
const v2 = {
  schema: 2,
  id: 'aurora-glass',
  name: 'Aurora Glass',
  base: 'glossy-glass',
  tokens: { '--accent': '#7ce0c3' },
  gradients: { shell: { angle: 160, stops: [['#0b1020', 0], ['#1b2a4a', 100]] } },
  fonts: { ui: 'segoe-ui', grid: 'consolas' },
  shape: { radius: 'soft', border: 'thin', shadow: 'soft' },
  effects: { pageTransition: { preset: 'fade-slide', speed: 1 }, accentGlow: { intensity: 0.4 } },
  background: { scene: 'particles', colors: ['#7ce0c3', '#7db7ff'], density: 0.5, speed: 0.3 }
}
const bad = (patch: Record<string, unknown>) => validateTheme({ ...v2, ...patch })

describe('schema v1 files are unchanged', () => {
  it('has no schema / v2 fields and no warnings', () => {
    const r = validateTheme(v1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.theme).toEqual({ ...v1, builtin: false })
      expect('v2' in r.theme).toBe(false)
      expect(r.warnings).toEqual([])
    }
  })
  it('accepts an explicit schema 1; v1 hostile values still reject', () => {
    expect(validateTheme({ ...v1, schema: 1 }).ok).toBe(true)
    expect(validateTheme({ ...v1, tokens: { '--accent': 'url(x)' } }).ok).toBe(false)
  })
})

describe('schema v2', () => {
  it('accepts a valid file and compiles gradients without url()', () => {
    const r = validateTheme(v2)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.theme.schema).toBe(2)
    expect(r.warnings).toEqual([])
    expect(r.theme.v2?.fonts).toEqual({ ui: 'segoe-ui', grid: 'consolas' })
    expect(r.theme.v2?.background?.scene).toBe('particles')
    const css = gradientToCss(r.theme.v2!.gradients.shell!)
    expect(css).toBe('linear-gradient(160deg, #0b1020 0%, #1b2a4a 100%)')
    expect(css).not.toMatch(/url/i)
  })
  it('rejects a newer or invalid schema number', () => {
    const n = validateTheme({ ...v2, schema: 3 })
    expect(n.ok).toBe(false)
    if (!n.ok) expect(n.errors.join(' ')).toMatch(/newer version/)
    expect(validateTheme({ ...v2, schema: 'two' }).ok).toBe(false)
  })
  it('rejects hostile gradient values (whole file)', () => {
    for (const c of ['url(http://x/y.png)', 'red; x:y', 'expression(1)', '#fff}body{', 'javascript:1', '@import x']) {
      expect(bad({ gradients: { shell: { stops: [[c, 0], ['#000000', 100]] } } }).ok, c).toBe(false)
    }
    expect(bad({ gradients: { shell: { stops: [['#000000', 0]] } } }).ok).toBe(false)
    expect(bad({ gradients: { shell: { stops: Array.from({ length: 7 }, () => ['#000000', 1]) } } }).ok).toBe(false)
    expect(bad({ gradients: { shell: { stops: [['#000000', 'x'], ['#ffffff', 5]] } } }).ok).toBe(false)
    expect(bad({ gradients: { shell: { kind: 'conic', stops: [['#000000', 0], ['#ffffff', 5]] } } }).ok).toBe(false)
  })
  it('rejects hostile font, shape, effect and scene values', () => {
    expect(bad({ fonts: { ui: "x; background: url(y)" } }).ok).toBe(false)
    expect(bad({ fonts: { ui: 'url(a)' } }).ok).toBe(false)
    expect(bad({ shape: { radius: 'soft}x{' } }).ok).toBe(false)
    expect(bad({ effects: { ambient: { preset: 'import' } } }).ok).toBe(false)
    expect(bad({ background: { scene: '<script>' } }).ok).toBe(false)
    expect(bad({ background: { scene: 'particles', colors: ['url(x)'] } }).ok).toBe(false)
    expect(bad({ background: { scene: 'particles', colors: ['#fff', '#fff', '#fff', '#fff', '#fff'] } }).ok).toBe(false)
  })
  it('rejects wrong types for sections', () => {
    for (const k of ['gradients', 'fonts', 'shape', 'effects', 'background']) expect(bad({ [k]: 'x' }).ok, k).toBe(false)
    expect(bad({ effects: { accentGlow: { intensity: 'high' } } }).ok).toBe(false)
  })
  it('clamps out-of-range numbers with a warning', () => {
    const r = validateTheme({
      ...v2,
      gradients: { shell: { angle: 900, stops: [['#000000', -5], ['#ffffff', 400]] } },
      effects: { pageTransition: { preset: 'fade', speed: 99 }, accentGlow: { intensity: 5 } },
      background: { scene: 'waves', density: 9, speed: 9, intensity: -1 }
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.theme.v2?.gradients.shell).toEqual({ kind: 'linear', angle: 360, stops: [{ color: '#000000', at: 0 }, { color: '#ffffff', at: 100 }] })
    expect(r.theme.v2?.effects.pageTransition?.speed).toBe(3)
    expect(r.theme.v2?.effects.accentGlow?.intensity).toBe(1)
    expect(r.theme.v2?.background).toMatchObject({ density: 1, speed: 2, intensity: 0 })
    expect(r.warnings.length).toBeGreaterThanOrEqual(7)
  })
  it('unknown scene / preset / font / keys warn and fall back instead of failing', () => {
    const r = validateTheme({
      ...v2,
      fonts: { ui: 'comic-sans-9000', print: 'arial' },
      effects: { pageTransition: { preset: 'explode', speed: 1 }, laser: {} },
      background: { scene: 'black-hole' },
      shape: { radius: 'blob', extra: 1 },
      gradients: { wallpaper: { stops: [['#000000', 0], ['#ffffff', 1]] } },
      mystery: 1
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.theme.v2?.background).toBeUndefined()
    expect(r.theme.v2?.fonts).toEqual({})
    expect(r.theme.v2?.effects.pageTransition).toEqual({ preset: 'none' })
    expect(r.theme.v2?.shape).toEqual({})
    const w = r.warnings.join('\n')
    for (const s of ['black-hole', 'explode', 'comic-sans-9000', 'laser', 'wallpaper', 'mystery', 'print', 'blob']) expect(w).toContain(s)
  })
  it('sections are ignored (not validated) on a schema-less file', () => {
    const r = validateTheme({ ...v1, background: { scene: 'url(x)' } })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.theme.v2).toBeUndefined()
  })
  it('keeps the v1 token rules inside a v2 file', () => {
    expect(bad({ tokens: { '--accent': 'url(x)' } }).ok).toBe(false)
    const r = bad({ tokens: { '--row-height': '99px' } })
    expect(r.ok && r.warnings.join(' ')).toMatch(/clamped/)
  })
  it('colour helper accepts hex / rgb(a) only', () => {
    expect(normaliseColor('#ABC')).toBe('#abc')
    expect(normaliseColor('rgba(1, 2, 3, 0.5)')).toBe('rgba(1, 2, 3, 0.5)')
    expect(normaliseColor('rgb(1,2,3)')).toBe('rgb(1, 2, 3)')
    for (const c of ['red', 'rgb(300,0,0)', 'rgba(1,2,3,2)', 'var(--x)', 'url(a)', 5, '']) expect(normaliseColor(c), String(c)).toBeNull()
  })
  it('registries and tokens', () => {
    expect(SCENE_NAMES).toContain('none')
    for (const t of ['--gradient-shell', '--gradient-panel', '--gradient-accent', '--accent-glow']) expect(TOKEN_NAMES).toContain(t)
  })
})
