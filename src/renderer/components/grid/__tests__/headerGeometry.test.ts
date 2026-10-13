/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGridColumns, gridTemplateColumns } from '@shared/gridModel'
import { resolveFormat } from '@shared/format/registry'

/**
 * Phase 70 - header / body column geometry. The pixel check itself needs a real window (tests-e2e/08-...); these guard the
 * two things that can be proven from source: ONE template string drives both rows, and nothing later in the stylesheet
 * silently overrides the sticky header cells (the bug that let the header's Sl.No / Item Name scroll away from the body's).
 */
const css = readFileSync(resolve('src/renderer/styles/grid.css'), 'utf8')

describe('Phase 70 - header vs body column geometry', () => {
  it('header row and body rows share one grid-template-columns variable', () => {
    const rule = css.match(/\.q3-gh,\s*\.q3-gr\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toContain('grid-template-columns: var(--q3-grid-cols)')
  })
  it('header and body cells share one rule with the same box model and border', () => {
    const rule = css.match(/\.q3-gc,\s*\.q3-gh__cell\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toContain('box-sizing: border-box')
    expect(rule).toContain('border-right: 1px solid var(--grid-line)')
  })
  it('no plain `.q3-gh__cell { position: relative }` after the sticky rule (it would beat it)', () => {
    expect(css).not.toMatch(/\.q3-gh__cell\s*\{\s*position:\s*relative;?\s*\}/)
    expect(css).toMatch(/\.q3-gh__cell:not\(\[data-col="slNo"\]\):not\(\[data-col="name"\]\)\s*\{\s*position:\s*relative/)
  })
  it('the template is derived once from the columns (flex column = minmax(px, 1fr), others fixed px)', () => {
    const t = gridTemplateColumns(buildGridColumns(resolveFormat('non_gst'), []))
    expect(t).toMatch(/minmax\(\d+px, 1fr\)/)
    expect(t.split(' ').length).toBeGreaterThan(3)
  })
})
