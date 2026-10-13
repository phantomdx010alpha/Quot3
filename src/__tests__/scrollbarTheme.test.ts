import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Phase 97 - scrollbars come from the Phase 96 tokens only; nothing styles them with a literal colour. */
const STYLES = resolve(__dirname, '../renderer/styles')
const strip = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '')
const ui = strip(readFileSync(join(STYLES, 'ui.css'), 'utf8'))

describe('theme-aware scrollbars (static)', () => {
  it('ui.css styles the scrollbar, thumb, track and hover from the tokens', () => {
    expect(ui).toMatch(/\*::-webkit-scrollbar\s*\{[^}]*var\(--scrollbar-size\)/)
    expect(ui).toMatch(/::-webkit-scrollbar-track\s*\{[^}]*var\(--scrollbar-track\)/)
    expect(ui).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*var\(--scrollbar-thumb\)/)
    expect(ui).toMatch(/::-webkit-scrollbar-thumb:hover\s*\{[^}]*var\(--scrollbar-thumb-hover\)/)
    expect(ui).toMatch(/scrollbar-color:\s*var\(--scrollbar-thumb\)\s+var\(--scrollbar-track\)/)
  })
  it('the thumb is rounded', () => {
    expect(ui).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*border-radius/)
  })
  it('no stylesheet or component sets a scrollbar colour with a literal', () => {
    const files = readdirSync(STYLES).filter((f) => f.endsWith('.css') && f !== 'tokens.css').map((f) => join(STYLES, f))
    for (const f of files) {
      const text = strip(readFileSync(f, 'utf8'))
      for (const m of text.matchAll(/[^{};]*scrollbar[^{};:]*(?:\{[^}]*\}|:[^;}]*)/g)) {
        expect(m[0], `${f}`).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\b(black|white|gray|grey)\b/i)
      }
    }
  })
  it('every built-in theme defines the scrollbar colour tokens', () => {
    const tokens = readFileSync(join(STYLES, 'tokens.css'), 'utf8')
    for (const n of ['--scrollbar-track', '--scrollbar-thumb', '--scrollbar-thumb-hover']) expect((tokens.match(new RegExp(`${n}:`, 'g')) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})
