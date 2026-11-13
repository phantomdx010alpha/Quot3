import { describe, expect, it } from 'vitest'
import { boundsToClip, cellText, clearBounds, fillDown, fillRight, gridColumns, gridShape, isBlankRow, isDraftAllowed, isTypable, pasteInto, withCellText } from '../gridModel'
import { defaultColumnSet } from '../columns'
import { SEED_TIERS } from '../tiers'
import { newRow } from '../rows'
import type { PriceRow } from '../types'

// Invented names only (rule: no real data in tests).
const columns = defaultColumnSet(SEED_TIERS)
const cols = gridColumns(columns)
const row = (id: string, name: string, cells: Record<string, string> = {}): PriceRow => ({ ...newRow(id, 't1', 0, 'item', name), cells })
const priceKey = cols[1]!.key

describe('Phase 238 - Price List grid model', () => {
  it('shows the item name first, then the price columns; hidden columns are skipped', () => {
    expect(cols[0]!.isName).toBe(true)
    expect(cols.length).toBe(1 + SEED_TIERS.length)
    const hid = gridColumns(columns.map((c, i) => (i === 1 ? { ...c, hidden: true } : c)))
    expect(hid.length).toBe(cols.length - 1)
  })

  it('writes a price as a canonical decimal string and refuses text; the name keeps its runs', () => {
    const r = row('a', 'Acme panna')
    const ok = withCellText(r, cols[1]!, '110.50')
    expect(ok && cellText(ok, cols[1]!)).toBe('110.5')
    expect(withCellText(r, cols[1]!, 'abc')).toBeNull()
    expect(isDraftAllowed(cols[1]!, '12a')).toBe(false)
    expect(isDraftAllowed(cols[0]!, 'any text')).toBe(true)
    const named = withCellText(r, cols[0]!, 'Acme panna big')
    expect(named && cellText(named, cols[0]!)).toBe('Acme panna big')
  })

  it('a section row only accepts typing in the name column', () => {
    const s = { ...row('s', 'BIG PANNA'), kind: 'section' as const }
    expect(isTypable(s, cols[0]!)).toBe(true)
    expect(isTypable(s, cols[1]!)).toBe(false)
  })

  it('gridShape reports the size and the text of each cell for the navigation reducer', () => {
    const rows = [row('a', 'One', { [priceKey]: '5' }), row('b', 'Two')]
    const shape = gridShape(rows, cols)
    expect(shape.rowCount).toBe(2)
    expect(shape.colCount).toBe(cols.length)
    expect(shape.cellText(0, 1)).toBe('5')
    expect(shape.cellText(1, 0)).toBe('Two')
  })

  it('clear, fill down and fill right work on a rectangle', () => {
    const rows = [row('a', 'One', { [priceKey]: '5' }), row('b', 'Two'), row('c', 'Three')]
    const filled = fillDown(rows, cols, { top: 0, left: 1, bottom: 2, right: 1 })
    expect(filled.map((r) => r.cells[priceKey])).toEqual(['5', '5', '5'])
    const cleared = clearBounds(filled, cols, { top: 1, left: 1, bottom: 2, right: 1 })
    expect(cleared.map((r) => r.cells[priceKey] ?? '')).toEqual(['5', '', ''])
    const right = fillRight([row('r', 'Row', { [priceKey]: '7' })], cols, { top: 0, left: 1, bottom: 0, right: 3 })
    expect(cols.slice(1, 4).map((c) => right[0]!.cells[c.key])).toEqual(['7', '7', '7'])
  })

  it('paste from Excel text lands from the cursor, adds rows, and counts cells that do not fit', () => {
    let n = 0
    const res = pasteInto([row('a', 'One')], cols, [[{ text: 'Alpha' }, { text: '10' }], [{ text: 'Beta' }, { text: 'x' }]], 0, 0, 't1', () => `tmp-${++n}`)
    expect(res.rows.length).toBe(2)
    expect(cellText(res.rows[0]!, cols[0]!)).toBe('Alpha')
    expect(res.rows[0]!.cells[priceKey]).toBe('10')
    expect(res.notWritten).toBe(1)
    expect(res.written).toBe(3)
  })

  it('copy gives the same cells back, and a blank row is recognised', () => {
    const rows = [row('a', 'One', { [priceKey]: '5' })]
    expect(boundsToClip(rows, cols, { top: 0, left: 0, bottom: 0, right: 1 }).map((l) => l.map((c) => c.text))).toEqual([['One', '5']])
    expect(isBlankRow(newRow('x', 't1', 0))).toBe(true)
    expect(isBlankRow(rows[0]!)).toBe(false)
  })
})
