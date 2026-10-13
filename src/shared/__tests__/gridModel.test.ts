import { describe, expect, it } from 'vitest'
import { buildGridColumns, buildGridView, countTrailingBlankRows, ensureTrailingBlankRows, EXTRA_COL_WIDTH_PX, gridTemplateColumns, isEntryBlank, MIN_TRAILING_BLANK_ROWS } from '../gridModel'
import { getFormat } from '../format/registry'
import { bigGridBill, legacyGridBill } from '../__fixtures__/gridBills'
import { blankRow, row } from '../__fixtures__/bills'
import { computeBill } from '../calc/billTotals'

const NG = () => getFormat('non_gst')
const G = () => getFormat('gst')

describe('trailing blank rows', () => {
  it('pads to at least 3 and is a no-op (same array) once satisfied', () => {
    const rows = [row('a', '1', '1')]
    const padded = ensureTrailingBlankRows(rows)
    expect(padded).toHaveLength(1 + MIN_TRAILING_BLANK_ROWS)
    expect(countTrailingBlankRows(padded)).toBe(3)
    expect(ensureTrailingBlankRows(padded)).toBe(padded)
    expect(padded.map((r) => r.idx)).toEqual([0, 1, 2, 3])
  })
  it('empty bill gets 3 blank rows; a used row among the last 3 triggers re-padding', () => {
    expect(ensureTrailingBlankRows([])).toHaveLength(3)
    const p = ensureTrailingBlankRows([row('a', '1', '1')])
    const used = p.map((r, i) => (i === 3 ? { ...r, nameRuns: [{ t: 'typed' }] } : r))
    expect(countTrailingBlankRows(used)).toBe(0)
    expect(countTrailingBlankRows(ensureTrailingBlankRows(used))).toBe(3)
  })
  it('a row with only extras text, a mark, or styling is NOT blank', () => {
    expect(isEntryBlank(blankRow())).toBe(true)
    expect(isEntryBlank({ ...blankRow(), extras: { c: { text: '5-1' } } })).toBe(false)
    expect(isEntryBlank({ ...blankRow(), extras: { c: { text: '', marked: true } } })).toBe(false)
    expect(isEntryBlank({ ...blankRow(), extras: { c: { text: '  ' } } })).toBe(true)
    expect(isEntryBlank({ ...blankRow(), cellStyle: { name: { hl: 1 } } })).toBe(false)
  })
})

describe('buildGridColumns', () => {
  it('non-GST: registry columns, then extras', () => {
    const cols = buildGridColumns(NG(), [{ key: 'x', header: 'ruby', kind: 'units' }])
    expect(cols.map((c) => c.key)).toEqual(['slNo', 'name', 'qty', 'rate', 'total', 'x'])
    expect(cols.at(-1)).toMatchObject({ label: 'ruby', isExtra: true, widthPx: EXTRA_COL_WIDTH_PX, align: 'left' })
  })
  it('GST: all eight columns in order', () => {
    expect(buildGridColumns(G(), []).map((c) => c.key)).toEqual(['slNo', 'name', 'qty', 'rate', 'total', 'gstRate', 'gstAmt', 'amount'])
  })
  it('only the rich-text column is flexible; template string matches', () => {
    const cols = buildGridColumns(NG(), [])
    expect(cols.filter((c) => c.flex).map((c) => c.key)).toEqual(['name'])
    const t = gridTemplateColumns(cols)
    expect(t).toContain('minmax(')
    expect(t.startsWith(`${cols[0]!.widthPx}px minmax(${cols[1]!.widthPx}px, 1fr)`)).toBe(true)
  })
})

describe('buildGridView', () => {
  it('body = item/blank/partial rows in order; adjustments + totals go to the footer', () => {
    const b = bigGridBill(20)
    const v = buildGridView(NG(), ensureTrailingBlankRows(b.rows))
    const adj = b.rows[19]!
    expect(v.bodyIds).not.toContain(adj.id)
    expect(v.bodyIds).toHaveLength(19 + 3)
    expect(v.footer.map((d) => d.kind)).toEqual(['itemsTotal', 'adjustment', 'adjustmentsTotal', 'grandTotal'])
    expect(v.footer[1]!.rowId).toBe(adj.id)
  })
  it('legacy bill: footer grand total is 17,226.00 and Sl.No is gapless', () => {
    const b = legacyGridBill()
    const v = buildGridView(NG(), b.rows)
    expect(v.footer).toHaveLength(1)
    expect(v.footer[0]).toMatchObject({ kind: 'grandTotal' })
    expect(v.footer[0]!.cells.total).toBe('17226.00')
    expect(v.bodyIds.map((id) => v.body[id]!.cells.slNo)).toEqual(Array.from({ length: 18 }, (_, i) => String(i + 1)))
  })
  it('extra-column text is available per cell key', () => {
    const b = legacyGridBill()
    const v = buildGridView(NG(), b.rows)
    expect(v.body[b.rows[0]!.id]!.cells.ruby).toBe('11.5-1')
    expect(v.body[b.rows[0]!.id]!.cells.tomato).toBe('5-4')
  })
  it('structural sharing: unchanged rows/footer keep identity; changed row gets a new object', () => {
    const b = bigGridBill(30)
    const rows = ensureTrailingBlankRows(b.rows)
    const v1 = buildGridView(NG(), rows)
    const rows2 = rows.slice(); rows2[4] = { ...rows[4]!, nameRuns: [{ t: 'renamed' }] }
    const v2 = buildGridView(NG(), rows2, v1)
    const changed = Object.keys(v2.body).filter((id) => v2.body[id] !== v1.body[id])
    expect(changed).toEqual([rows[4]!.id])
    expect(v2.bodyIds).toBe(v1.bodyIds)
    expect(v2.footer).toBe(v1.footer) // a rename does not change any total
    const rows3 = rows.slice(); rows3[4] = { ...rows[4]!, qty: '99' }
    const v3 = buildGridView(NG(), rows3, v1)
    expect(v3.footer).not.toBe(v1.footer)
    expect(Object.keys(v3.body).filter((id) => v3.body[id] !== v1.body[id])).toEqual([rows[4]!.id])
  })
  it('the view agrees with computeBill (grand total) for both formats', () => {
    const b = bigGridBill(80)
    for (const f of [NG(), G()]) {
      const v = buildGridView(f, b.rows)
      expect(v.footer.at(-1)!.cells.amount ?? v.footer.at(-1)!.cells.total).toBe(computeBill(f, b.rows).grandTotal)
    }
  })
  it('switching format reuses rows and changes only column-driven cells', () => {
    const b = bigGridBill(10)
    const v = buildGridView(NG(), b.rows)
    const g = buildGridView(G(), b.rows, v)
    expect(g.bodyIds).toBe(v.bodyIds)
    expect(g.body[b.rows[0]!.id]!.cells.gstAmt).toBeDefined()
  })
})
