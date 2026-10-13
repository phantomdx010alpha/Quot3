import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../shared/theme/contrast'
import { TOKEN_NAMES } from '../shared/theme/tokens'

const STYLES = resolve(__dirname, '../renderer/styles')
const css = readFileSync(join(STYLES, 'tokens.css'), 'utf8')

/** Split tokens.css into { selector -> { token -> value } }. */
function parseBlocks(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  const re = /([^{}@]+?)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text.replace(/\/\*[\s\S]*?\*\//g, '')))) {
    const sel = m[1]!.trim()
    const decls = (out[sel] ??= {})
    for (const d of m[2]!.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) decls[d[1]!] = d[2]!.trim()
  }
  return out
}

const blocks = parseBlocks(css)
/** Merge every block whose selector list mentions `needle` (Navy Ember is also the bare-:root fallback). */
const pick = (needle: string): Record<string, string> =>
  Object.assign({}, ...Object.entries(blocks).filter(([sel]) => sel.includes(needle)).map(([, d]) => d))
const root = blocks[':root'] ?? {}
const navy = pick("data-theme='navy-ember'")
const paper = pick("data-theme='paper'")
const glass = pick("data-theme='glossy-glass'")
const space = pick("data-theme='space'")
const redNavy = pick("data-theme='red-navy'")
const redBlack = pick("data-theme='red-black'")

describe('tokens.css parity with the whitelist', () => {
  it('both built-in theme blocks exist', () => {
    expect(Object.keys(navy).length).toBeGreaterThan(20)
    expect(Object.keys(paper).length).toBeGreaterThan(20)
    expect(Object.keys(glass).length).toBeGreaterThan(20)
    expect(Object.keys(space).length).toBeGreaterThan(20)
    expect(Object.keys(redNavy).length).toBeGreaterThan(20)
    expect(Object.keys(redBlack).length).toBeGreaterThan(20)
  })

  it('every defined token is whitelisted, and every whitelisted token is defined', () => {
    const defined = new Set([...Object.keys(root), ...Object.keys(navy), ...Object.keys(paper), ...Object.keys(glass), ...Object.keys(space), ...Object.keys(redNavy), ...Object.keys(redBlack)])
    const whitelist = new Set(TOKEN_NAMES)
    expect([...defined].filter((n) => !whitelist.has(n))).toEqual([])
    expect([...whitelist].filter((n) => !defined.has(n))).toEqual([])
  })

  it('Navy Ember and Paper define exactly the same theme-specific tokens', () => {
    expect(Object.keys(paper).sort()).toEqual(Object.keys(navy).sort())
  })

  it('Phase 102: Red Deep-Black defines exactly the same theme-specific tokens as Navy Ember', () => {
    expect(Object.keys(redBlack).sort()).toEqual(Object.keys(navy).sort())
  })

  it('Phase 101: Red and Navy Blue defines exactly the same theme-specific tokens as Navy Ember', () => {
    expect(Object.keys(redNavy).sort()).toEqual(Object.keys(navy).sort())
  })

  it('Phase 100: Space defines every theme-specific token plus its own non-neumorphic shadow trio', () => {
    expect(Object.keys(space).sort()).toEqual([...Object.keys(navy), '--shadow-raised', '--shadow-inset', '--shadow-pressed'].sort())
  })

  it('Phase 99: Glossy Glass defines every theme-specific token (the built-ins plus its own --glass-blur)', () => {
    expect(Object.keys(glass).sort()).toEqual([...Object.keys(navy), '--glass-blur'].sort())
  })
})

describe.each([
  ['navy-ember', navy],
  ['paper', paper],
  ['glossy-glass', glass],
  ['space', space],
  ['red-navy', redNavy],
  ['red-black', redBlack]
])('contrast: %s', (_name, t) => {
  const c = (a: string, b: string): number => contrastRatio(t[a]!, t[b]!)
  it('grid text >= 7:1 on the grid surfaces', () => {
    expect(c('--text-primary', '--surface-grid')).toBeGreaterThanOrEqual(7)
    expect(c('--text-primary', '--surface-grid-alt')).toBeGreaterThanOrEqual(7)
  })
  it('body text >= 4.5:1 on base/raised/inset', () => {
    for (const s of ['--surface-base', '--surface-raised', '--surface-inset']) {
      expect(c('--text-primary', s)).toBeGreaterThanOrEqual(4.5)
      expect(c('--text-secondary', s)).toBeGreaterThanOrEqual(4.5)
      expect(c('--text-muted', s)).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('accent button text and Red+Bold are legible', () => {
    expect(c('--text-on-accent', '--accent')).toBeGreaterThanOrEqual(4.5)
    expect(c('--rt-red', '--surface-grid')).toBeGreaterThanOrEqual(4.5)
  })
  it('Phase 96: scrollbar thumb is visible on its track; title bar symbols are legible (normal and hover)', () => {
    expect(c('--scrollbar-thumb', '--scrollbar-track')).toBeGreaterThanOrEqual(3)
    expect(c('--scrollbar-thumb-hover', '--scrollbar-track')).toBeGreaterThanOrEqual(3)
    for (const fg of ['--titlebar-fg', '--titlebar-symbol']) {
      expect(c(fg, '--titlebar-bg')).toBeGreaterThanOrEqual(4.5)
      expect(c(fg, '--titlebar-hover')).toBeGreaterThanOrEqual(4.5)
    }
  })
  it.runIf(_name === 'paper')('Paper: Red+Bold red is also legible on white', () => {
    expect(contrastRatio(t['--rt-red']!, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
  // Navy Ember's --rt-red is tuned for the dark grid (<4.5:1 on white by nature). Print/PDF/image
  // output uses its own --print-* red (Phase 33), so the UI red never has to meet white-paper contrast.
})

describe('Phase 96 tokens', () => {
  const NEW = ['--scrollbar-track', '--scrollbar-thumb', '--scrollbar-thumb-hover', '--scrollbar-size', '--titlebar-bg', '--titlebar-fg',
    '--titlebar-symbol', '--titlebar-hover', '--titlebar-height', '--surface-glass', '--glass-blur', '--glass-border', '--bg-image']
  it('are whitelisted and every built-in theme resolves every one (theme block or :root default)', () => {
    for (const t of [navy, paper, glass, space, redNavy, redBlack]) for (const n of NEW) {
      expect(TOKEN_NAMES).toContain(n)
      expect(t[n] ?? root[n], n).toBeTruthy()
    }
  })
  it('Phase 99: Glossy Glass is the only built-in with blur / a background image; blur is inside the 0-24px clamp; gradients only (no url)', () => {
    const blur = parseFloat(glass['--glass-blur']!)
    expect(blur).toBeGreaterThan(0)
    expect(blur).toBeLessThanOrEqual(24)
    expect(glass['--bg-image']).toMatch(/gradient\(/)
    expect(glass['--bg-image']).not.toMatch(/url\(/i)
  })
  it('Phase 99: glass blur is applied to chrome selectors only, never to grid rules', () => {
    const ui = readFileSync(join(STYLES, 'ui.css'), 'utf8')
    const gridCss = readFileSync(join(STYLES, 'grid.css'), 'utf8')
    expect(ui).toContain("[data-theme='glossy-glass'] .q3-rail")
    expect(gridCss).not.toMatch(/backdrop-filter|--glass-blur|--surface-glass/)
    expect(ui).toMatch(/backdrop-filter:\s*blur\(var\(--glass-blur\)\)/)
  })
  it('Phase 100: Space is gradients-only (no url) and uses no blur', () => {
    expect(space['--bg-image']).toMatch(/gradient\(/)
    expect(space['--bg-image']).not.toMatch(/url\(/i)
    expect(space['--glass-blur'] ?? root['--glass-blur']).toBe('0px')
  })
  it('Phase 100: Space raised / inset / pressed are non-neumorphic and distinguishable without colour', () => {
    const r = space['--shadow-raised']!, i = space['--shadow-inset']!, p = space['--shadow-pressed']!
    expect(r).not.toMatch(/inset/)                       // raised is outer only
    expect(i.startsWith('inset')).toBe(true)             // inset is inner only
    expect(p.startsWith('inset')).toBe(true)
    expect(new Set([r, i, p]).size).toBe(3)              // three different shapes
    expect(p).toContain('2px')                           // pressed ring is heavier than the inset ring
    expect(i).toContain('0 0 0 1px')
    for (const v of [r, i, p]) expect(v).not.toMatch(/--shadow-dist|-\d+px/) // no mirrored light/dark offset pairs
  })
  it('Phase 101: Red and Navy Blue is its own palette: base/accent differ from Navy Ember, and Red+Bold is far from the accent', () => {
    expect(redNavy['--surface-base']).not.toBe(navy['--surface-base'])
    expect(redNavy['--accent']).not.toBe(navy['--accent'])
    const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    const dist = (a: string, b: string): number => rgb(a).reduce((s, v, i) => s + Math.abs(v - rgb(b)[i]!), 0)
    expect(dist(redNavy['--rt-red']!, redNavy['--accent']!)).toBeGreaterThanOrEqual(80)
    expect(dist(redNavy['--accent']!, navy['--accent']!)).toBeGreaterThanOrEqual(60)
    expect(contrastRatio(redNavy['--rt-red']!, redNavy['--surface-grid-alt']!)).toBeGreaterThanOrEqual(4.5)
  })
  it('Phase 102: Red Deep-Black is OLED-dark (every surface luminance tiny, inset pure black) with a red accent and Red+Bold far from it', () => {
    const lum = (h: string): number => contrastRatio(h, '#000000') // 1 = black; grows with brightness
    for (const k of ['--surface-base', '--surface-raised', '--surface-inset', '--surface-grid', '--surface-grid-alt']) expect(lum(redBlack[k]!), k).toBeLessThan(1.3)
    expect(redBlack['--surface-inset']).toBe('#000000')
    const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    const [r, g, b] = rgb(redBlack['--accent']!) as [number, number, number]
    expect(r).toBeGreaterThan(g * 3)
    expect(r).toBeGreaterThan(b * 3)
    const dist = rgb(redBlack['--rt-red']!).reduce((s, v, i) => s + Math.abs(v - rgb(redBlack['--accent']!)[i]!), 0)
    expect(dist).toBeGreaterThanOrEqual(80)
    expect(contrastRatio(redBlack['--text-on-accent']!, redBlack['--accent']!)).toBeGreaterThanOrEqual(4.5)
  })
  it('built-in themes use no blur and no background image (grid stays flat)', () => {
    for (const t of [navy, paper, redNavy, redBlack]) {
      expect(t['--glass-blur'] ?? root['--glass-blur']).toBe('0px')
      expect(t['--bg-image']).toBe('none')
    }
  })
})

describe('no hardcoded colours in components', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) walk(p, out)
      else if (/\.(tsx?|css)$/.test(n)) out.push(p)
    }
    return out
  }
  const files = [
    ...walk(resolve(__dirname, '../renderer/components')),
    ...walk(resolve(__dirname, '../renderer/pages')),
    join(STYLES, 'ui.css'),
    join(STYLES, 'grid.css'),
    join(STYLES, 'neumorph.css')
  ]
  it('no hex / rgb() / hsl() literals', () => {
    const offenders: string[] = []
    for (const f of files) {
      const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(text)) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })
})
