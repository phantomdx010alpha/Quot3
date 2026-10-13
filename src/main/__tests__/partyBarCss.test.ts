import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Lives under src/main so it type-checks with Node types; it only reads the renderer stylesheet as text.
describe('Phase 25 — party bar height budget (arithmetic from the stylesheet; real layout unseen)', () => {
  const css = readFileSync(resolve('src/renderer/styles/grid.css'), 'utf8')
  const tokens = readFileSync(resolve('src/renderer/styles/tokens.css'), 'utf8')
  it('row + vertical padding ≤ 72 px with the address closed', () => {
    const row = Number(/\.q3-pbar__row \{[^}]*height: (\d+)px/.exec(css)?.[1])
    const space1 = Number(/--space-1:\s*(\d+)px/.exec(tokens)?.[1])
    expect(Number.isFinite(row) && Number.isFinite(space1)).toBe(true)
    expect(row + space1 * 2).toBeLessThanOrEqual(72)
  })
  it('the address pull-down overlays (absolute), so opening it never pushes the grid down', () => {
    expect(/\.q3-pbar__panel \{[^}]*position: absolute/.test(css)).toBe(true)
  })
})
