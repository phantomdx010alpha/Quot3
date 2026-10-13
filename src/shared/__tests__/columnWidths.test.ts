import { describe, expect, it } from 'vitest'
import { applyColWidths, clampColWidth, MAX_COL_WIDTH_PX, MIN_COL_WIDTH_PX, resetColWidth, resetFormatColWidths, sanitizeColWidths, setColWidth, sliceGraphemes, stickyOffsets } from '../columnWidths'
import { buildGridColumns, gridTemplateColumns } from '../gridModel'
import { resolveFormat } from '../format/registry'
import { sanitizeExtraHeader } from '../extraCols'
import { allShortcuts, findShortcutConflicts } from '../shortcuts'

const cols = () => buildGridColumns(resolveFormat('non_gst'), [{ key: 'c1', header: 'Col 1', kind: 'units' }])

describe('Phase 23 — column width policy', () => {
  it('clamps to [min, max], rounds, and survives garbage', () => {
    expect(clampColWidth(5)).toBe(MIN_COL_WIDTH_PX)
    expect(clampColWidth(99999)).toBe(MAX_COL_WIDTH_PX)
    expect(clampColWidth(100.6)).toBe(101)
    expect(clampColWidth(NaN)).toBe(MIN_COL_WIDTH_PX)
  })
  it('sanitises persisted data: bad shapes dropped, widths clamped', () => {
    expect(sanitizeColWidths(null)).toEqual({})
    expect(sanitizeColWidths([1])).toEqual({})
    expect(sanitizeColWidths({ gst: { name: 9999, qty: 'x', rate: 120 }, bad: 5, empty: {} })).toEqual({ gst: { name: MAX_COL_WIDTH_PX, rate: 120 } })
  })
  it('overrides apply per format + key, make a flex column fixed, and never mutate the input', () => {
    const base = cols()
    const copy = JSON.stringify(base)
    const out = applyColWidths(base, { name: 500, c1: 200 })
    expect(JSON.stringify(base)).toBe(copy)
    expect(out.find((c) => c.key === 'name')).toMatchObject({ widthPx: 500, flex: false })
    expect(out.find((c) => c.key === 'c1')?.widthPx).toBe(200)
    expect(out.find((c) => c.key === 'rate')).toBe(base.find((c) => c.key === 'rate')) // untouched columns keep identity
    expect(gridTemplateColumns(out)).toContain('500px')
    expect(gridTemplateColumns(base)).toContain('minmax(')
  })
  it('set / reset one / reset all are per format', () => {
    let o = setColWidth({}, 'gst', 'name', 300)
    o = setColWidth(o, 'non_gst', 'name', 400)
    expect(o).toEqual({ gst: { name: 300 }, non_gst: { name: 400 } })
    expect(resetColWidth(o, 'gst', 'name')).toEqual({ non_gst: { name: 400 } })
    expect(resetColWidth(o, 'gst', 'zzz')).toBe(o)
    expect(resetFormatColWidths(o, 'non_gst')).toEqual({ gst: { name: 300 } })
  })
  it('sticky offsets: Item Name sits after Sl.No (follows a resized Sl.No)', () => {
    expect(stickyOffsets(cols())).toEqual({ slNo: 0, name: 52 })
    expect(stickyOffsets(applyColWidths(cols(), { slNo: 80 }))).toEqual({ slNo: 0, name: 80 })
  })
  it('grapheme-safe slicing never splits emoji, ZWJ sequences, flags or combining marks; RTL cut in logical order', () => {
    expect(sliceGraphemes('ab🎁cd', 3)).toBe('ab🎁')
    expect(sliceGraphemes('👨‍👩‍👧‍👦x', 1)).toBe('👨‍👩‍👧‍👦')
    expect(sliceGraphemes('🇮🇳🇮🇳', 1)).toBe('🇮🇳')
    expect(sliceGraphemes('ée', 1)).toBe('é')
    expect(sliceGraphemes('مرحبا بالعالم', 5)).toBe('مرحبا')
    expect(sliceGraphemes('short', 40)).toBe('short')
  })
  it('extra-column header cap is grapheme-safe (40)', () => {
    const h = sanitizeExtraHeader('🎁'.repeat(60))
    expect(Array.from(h)).toHaveLength(40)
    expect(sanitizeExtraHeader('x'.repeat(100))).toHaveLength(40)
  })
  it('width shortcuts are registered without conflicts', () => {
    const k = allShortcuts().filter((s) => s.action.startsWith('grid.col')).map((s) => s.keys)
    expect(k).toEqual(['Ctrl+Alt+]', 'Ctrl+Alt+[', 'Ctrl+Alt+0'])
    expect(findShortcutConflicts()).toEqual([])
  })
})
