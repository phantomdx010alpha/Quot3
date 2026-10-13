import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_PREVIEW, PREVIEW_TOKENS, themePreview } from '../preview'
import { BUILTIN_THEMES, BUILTIN_THEME_IDS } from '../tokens'

const SRC = resolve(__dirname, '../../..')
const css = readFileSync(join(SRC, 'renderer/styles/tokens.css'), 'utf8')
const block = (id: string): string => { const i = css.indexOf(`:root[data-theme='${id}'] {`); return css.slice(i, css.indexOf('}', i)) }

describe('Phase 103: theme picker previews', () => {
  it('there is a preview and a tokens.css block for every built-in theme, and the swatches equal the CSS values', () => {
    expect(Object.keys(BUILTIN_PREVIEW).sort()).toEqual([...BUILTIN_THEME_IDS].sort())
    for (const t of BUILTIN_THEMES) {
      const b = block(t.id)
      expect(b, t.id).not.toBe('')
      for (const k of PREVIEW_TOKENS) {
        const m = new RegExp(`${k}:\\s*([^;]+);`).exec(b)
        expect(m?.[1]?.trim().toLowerCase(), `${t.id} ${k}`).toBe(BUILTIN_PREVIEW[t.id]![k])
      }
    }
  })
  it('a custom theme starts from its base and only plain #rrggbb overrides change a swatch', () => {
    const p = themePreview({ id: 'mine', base: 'space', tokens: { '--accent': '#112233', '--surface-base': 'url(x)', '--text-primary': 'red' } })
    expect(p['--accent']).toBe('#112233')
    expect(p['--surface-base']).toBe(BUILTIN_PREVIEW.space!['--surface-base'])
    expect(p['--text-primary']).toBe(BUILTIN_PREVIEW.space!['--text-primary'])
    expect(themePreview({ id: 'x', base: 'nope', tokens: {} })).toEqual(BUILTIN_PREVIEW['navy-ember'])
  })
})

describe('Phase 103: theme QA (static)', () => {
  const read = (p: string): string => readFileSync(join(SRC, p), 'utf8')
  it('every built-in theme is a tokens.css block, so scrollbars and the title strip (token-driven) follow every theme', () => {
    const ui = read('renderer/styles/ui.css')
    expect(ui).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*var\(--scrollbar-thumb\)/)
    expect(ui).toMatch(/\.q3-titlebar\s*\{[^}]*var\(--titlebar-bg\)/)
    for (const t of BUILTIN_THEMES) for (const n of ['--scrollbar-thumb:', '--titlebar-bg:']) expect(block(t.id), `${t.id} ${n}`).toContain(n)
  })
  it('dialogs and the shell are painted from tokens (no per-theme literal colours)', () => {
    const ui = read('renderer/styles/ui.css')
    expect(ui).toMatch(/\.q3-overlay\s*\{[^}]*var\(--overlay\)/)
    expect(ui).toMatch(/\.q3-shell\s*\{[^}]*var\(--surface-base\)/)
  })
  it('print code never reads theme tokens: print output is identical across themes', () => {
    const offenders: string[] = []
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) { if (n !== '__tests__') walk(p) } else if (/\.tsx?$/.test(n) && /data-theme|var\(--(surface|accent|text|grid|shadow|glass)|ThemeProvider/.test(readFileSync(p, 'utf8'))) offenders.push(p)
      }
    }
    for (const d of ['shared/print', 'main/print']) walk(join(SRC, d))
    expect(offenders).toEqual([])
  })
})
