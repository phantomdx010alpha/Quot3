import { describe, expect, it } from 'vitest'
import {
  applyFreeCellTexts, displayedTailCount, footerKeyOfKind, freeColumnHasData, freeNavIds, getFreeCell, isFreeRowId,
  parseFreeRowId, putFreeCell, stripFreeColumn, toggleFreeMark
} from '../freeCells'
import { summarizeUnits, unitsSummaryToText } from '../units'
import { legacyGridBill } from '../__fixtures__/gridBills'
import type { BillRow } from '../types'
import type { TailRow } from '../types'

describe('Phase 80 - free row ids', () => {
  it('parses footer and tail ids, rejects everything else', () => {
    expect(parseFreeRowId('fx:grandTotal')).toEqual({ kind: 'footer', key: 'grandTotal' })
    expect(parseFreeRowId('tr:0')).toEqual({ kind: 'tail', index: 0 })
    expect(parseFreeRowId('tr:12')).toEqual({ kind: 'tail', index: 12 })
    for (const bad of ['fx:roundOff', 'fx:', 'tr:', 'tr:-1', 'tr:1.5', 'tr:x', 'abc', 'row-1']) expect(parseFreeRowId(bad)).toBeNull()
    expect(isFreeRowId('fx:itemsTotal')).toBe(true)
    expect(isFreeRowId('row-1')).toBe(false)
  })
  it('maps footer kinds; round-off and adjustment rows have no free cells', () => {
    expect(footerKeyOfKind('itemsTotal')).toBe('itemsTotal')
    expect(footerKeyOfKind('grandTotal')).toBe('grandTotal')
    expect(footerKeyOfKind('roundOff')).toBeNull()
    expect(footerKeyOfKind('adjustment')).toBeNull()
  })
  it('navigation ids: display order; unchanged (body + adjustments) without extra columns', () => {
    const footer = [{ kind: 'itemsTotal' }, { kind: 'adjustment', rowId: 'a1' }, { kind: 'adjustmentsTotal' }, { kind: 'roundOff' }, { kind: 'grandTotal' }]
    expect(freeNavIds(['b1', 'b2'], footer, 0, 3)).toEqual(['b1', 'b2', 'a1'])
    expect(freeNavIds(['b1', 'b2'], footer, 1, 2)).toEqual(['b1', 'b2', 'fx:itemsTotal', 'a1', 'fx:adjustmentsTotal', 'fx:grandTotal', 'tr:0', 'tr:1'])
    expect(freeNavIds(['b1'], [{ kind: 'grandTotal' }], 2, 1)).toEqual(['b1', 'fx:grandTotal', 'tr:0'])
  })
  it('the tail always shows one blank entry row; the UI minimum can raise it', () => {
    expect(displayedTailCount(undefined, 0)).toBe(1)
    expect(displayedTailCount([{ extras: { c1: { text: 'x' } } }], 0)).toBe(2)
    expect(displayedTailCount([], 4)).toBe(4)
  })
})

describe('Phase 80 - editing free cells (pure)', () => {
  it('typing creates a footer cell; clearing removes it and the empty key; state returns to undefined', () => {
    const a = applyFreeCellTexts(undefined, undefined, [{ rowId: 'fx:grandTotal', colKey: 'c1', text: '5-2' }])!
    expect(a.footerExtras).toEqual({ grandTotal: { c1: { text: '5-2' } } })
    expect(a.tailRows).toBeUndefined()
    expect(getFreeCell(a.footerExtras, a.tailRows, 'fx:grandTotal', 'c1')).toEqual({ text: '5-2' })
    const b = applyFreeCellTexts(a.footerExtras, a.tailRows, [{ rowId: 'fx:grandTotal', colKey: 'c1', text: '' }])!
    expect(b.footerExtras).toBeUndefined()
  })
  it('unchanged text is "no change" (null)', () => {
    expect(applyFreeCellTexts(undefined, undefined, [{ rowId: 'fx:grandTotal', colKey: 'c1', text: '' }])).toBeNull()
    const a = applyFreeCellTexts(undefined, undefined, [{ rowId: 'tr:0', colKey: 'c1', text: 'x' }])!
    expect(applyFreeCellTexts(a.footerExtras, a.tailRows, [{ rowId: 'tr:0', colKey: 'c1', text: 'x' }])).toBeNull()
    expect(applyFreeCellTexts(undefined, undefined, [{ rowId: 'row-9', colKey: 'c1', text: 'x' }])).toBeNull()
  })
  it('typing far down the tail pads the rows between; trailing empty rows are trimmed again', () => {
    const a = applyFreeCellTexts(undefined, undefined, [{ rowId: 'tr:2', colKey: 'c1', text: '9-1' }])!
    expect(a.tailRows).toEqual([{ extras: {} }, { extras: {} }, { extras: { c1: { text: '9-1' } } }])
    const b = applyFreeCellTexts(a.footerExtras, a.tailRows, [{ rowId: 'tr:2', colKey: 'c1', text: '' }])!
    expect(b.tailRows).toBeUndefined()
    // clearing a cell that does not exist beyond the stored rows creates nothing
    expect(applyFreeCellTexts(undefined, undefined, [{ rowId: 'tr:5', colKey: 'c1', text: '' }])).toBeNull()
  })
  it('a marked cell keeps its mark when its text is cleared; a blank marked cell survives', () => {
    const m = toggleFreeMark(undefined, undefined, 'tr:0', 'c1')!
    expect(m.marked).toBe(true)
    expect(m.tailRows).toEqual([{ extras: { c1: { text: '', marked: true } } }])
    const t = applyFreeCellTexts(m.footerExtras, m.tailRows, [{ rowId: 'tr:0', colKey: 'c1', text: 'label' }])!
    expect(t.tailRows).toEqual([{ extras: { c1: { text: 'label', marked: true } } }])
    const u = toggleFreeMark(t.footerExtras, t.tailRows, 'tr:0', 'c1')!
    expect(u.marked).toBe(false)
    expect(u.tailRows).toEqual([{ extras: { c1: { text: 'label' } } }])
    const gone = toggleFreeMark(m.footerExtras, m.tailRows, 'tr:0', 'c1')!
    expect(gone.marked).toBe(false)
    expect(gone.tailRows).toBeUndefined()
    expect(toggleFreeMark(undefined, undefined, 'row-1', 'c1')).toBeNull()
  })
  it('two edits to one cell in one call compose; inputs are never mutated', () => {
    const fe = { grandTotal: { c1: { text: 'a' } } }
    const snap = JSON.stringify(fe)
    const r = applyFreeCellTexts(fe, undefined, [{ rowId: 'fx:grandTotal', colKey: 'c1', text: 'b' }, { rowId: 'fx:grandTotal', colKey: 'c1', text: 'c' }])!
    expect(r.footerExtras).toEqual({ grandTotal: { c1: { text: 'c' } } })
    expect(JSON.stringify(fe)).toBe(snap)
  })
  it('removing an extra column strips its free cells everywhere; data check sees them', () => {
    const fe = { itemsTotal: { c1: { text: '1-1' }, c2: { text: 'k' } }, grandTotal: { c1: { text: '2-2' } } }
    const tr: TailRow[] = [{ extras: { c1: { text: '3-3' } } }, { extras: { c2: { text: 'z' } } }]
    expect(freeColumnHasData(fe, tr, 'c1')).toBe(true)
    expect(freeColumnHasData(undefined, [{ extras: { c1: { text: '  ' } } }], 'c1')).toBe(false)
    const s = stripFreeColumn(fe, tr, 'c1')
    expect(s.footerExtras).toEqual({ itemsTotal: { c2: { text: 'k' } } })
    expect(s.tailRows).toEqual([{ extras: {} }, { extras: { c2: { text: 'z' } } }])
    expect(stripFreeColumn(fe, tr, 'c2').tailRows).toEqual([{ extras: { c1: { text: '3-3' } } }])
    expect(putFreeCell(undefined, undefined, 'fx:grandTotal', 'c1', { text: '' })).toBeNull()
  })
})

describe('Phase 80 - units count continues the last segment (display order)', () => {
  const bill = legacyGridBill()
  const view = (free?: Parameters<typeof summarizeUnits>[2]): string => unitsSummaryToText(summarizeUnits(bill.rows, bill.extraCols, free), 'marked')
  const base = (free?: Parameters<typeof summarizeUnits>[2]): string => unitsSummaryToText(summarizeUnits(bill.rows, bill.extraCols, free), 'units')

  it('no free cells = the legacy result (idk bruhh = 55, ruby = 12, tomato = 7)', () => {
    expect(view()).toBe('Column: ruby\n  idk bruhh = 55')
    expect(view({})).toBe('Column: ruby\n  idk bruhh = 55')
    expect(view({ footerExtras: {}, tailRows: [] })).toBe('Column: ruby\n  idk bruhh = 55')
  })
  it('a Final-total cell and tail cells add to the last marked segment', () => {
    const free = { footerExtras: { grandTotal: { ruby: { text: '7-2' } } }, tailRows: [{ extras: { ruby: { text: '9-3' } } }] }
    expect(view(free)).toBe('Column: ruby\n  idk bruhh = 60')
    expect(base(free)).toContain('ruby = 12')
  })
  it('with no marked cell the free cells continue the column header segment', () => {
    const rows = bill.rows.map((r: BillRow) => ({ ...r, extras: Object.fromEntries(Object.entries(r.extras).map(([k, v]) => [k, { text: v.text }])) }))
    const s = summarizeUnits(rows, bill.extraCols, { tailRows: [{ extras: { tomato: { text: '5-10' } } }] })
    expect(s.byColumn.find((c) => c.colKey === 'tomato')!.base.units).toBe('17')
  })
  it('a marked free cell starts its own segment; a hidden footer row is not counted', () => {
    const free = { footerExtras: { grandTotal: { ruby: { text: 'Extra stock', marked: true } } }, tailRows: [{ extras: { ruby: { text: '4-4' } } }] }
    const s = summarizeUnits(bill.rows, bill.extraCols, free)
    const ruby = s.byColumn[0]!
    expect(ruby.marked.map((m) => [m.label, m.units])).toEqual([['idk bruhh', '55'], ['Extra stock', '4']])
    expect(ruby.marked[1]!.rowId).toBe('fx:grandTotal')
    const hidden = summarizeUnits(bill.rows, bill.extraCols, { ...free, footerKinds: ['itemsTotal'] })
    expect(hidden.byColumn[0]!.marked.map((m) => [m.label, m.units])).toEqual([['idk bruhh', '59']])
  })
  it('an adjustment row counts AFTER the Items total cell (display order), not by array position', () => {
    const adj: BillRow = { ...bill.rows[0]!, id: 'adj', nameRuns: [{ t: 'Discount' }], qty: null, rate: null, totalOverride: '-10', extras: { ruby: { text: 'M', marked: true } } }
    const rows = [adj, ...bill.rows.map((r) => ({ ...r, extras: { ruby: { text: '1-1' } } }))]
    const s = summarizeUnits(rows, [bill.extraCols[0]!], { footerExtras: { itemsTotal: { ruby: { text: '5-5' } } }, footerKinds: ['itemsTotal', 'adjustmentsTotal', 'grandTotal'] })
    // items (18 x 1) + Items total (5) = base; the adjustment's mark then opens a segment that holds nothing else
    expect(s.byColumn[0]!.base.units).toBe('23')
    expect(s.byColumn[0]!.marked).toEqual([{ label: 'M', rowId: 'adj', units: '0' }])
  })
})

describe('Phase 104 - Down into footer extras and added tail rows', () => {
  const footer = [{ kind: 'itemsTotal' }, { kind: 'grandTotal' }]
  it('Down from the last item row reaches the Items total free row (extra columns on), and is skipped with none', () => {
    const ids = freeNavIds(['b1', 'b2'], footer, 1, 1)
    expect(ids[ids.indexOf('b2') + 1]).toBe('fx:itemsTotal')
    expect(freeNavIds(['b1', 'b2'], footer, 0, 1)).toEqual(['b1', 'b2'])
  })
  it('the bottom-most editable row is always a tail row once extra columns exist; one more shown row extends it by exactly one', () => {
    const ids = (shown: number) => freeNavIds(['b1'], footer, 1, displayedTailCount(undefined, shown))
    expect(ids(0)[ids(0).length - 1]).toBe('tr:0')
    expect(ids(2)).toHaveLength(ids(0).length + 1)
    expect(ids(2)[ids(2).length - 1]).toBe('tr:1')
  })
  it('an added (still empty) tail row is display-only: it is not stored, so trailing empties stay trimmed', () => {
    expect(putFreeCell(undefined, undefined, 'tr:1', 'x1', undefined)).toBeNull()
    const filled = putFreeCell(undefined, undefined, 'tr:1', 'x1', { text: 'hi' })
    expect(filled?.tailRows).toHaveLength(2)
    const cleared = putFreeCell(filled?.footerExtras, filled?.tailRows, 'tr:1', 'x1', undefined)
    expect(cleared?.tailRows).toBeUndefined()
  })
})
