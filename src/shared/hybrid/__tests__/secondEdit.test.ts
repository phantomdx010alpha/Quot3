import { describe, expect, it } from 'vitest'
import { createEmptyBill } from '../../billModel'
import { buildGridColumns, buildGridView } from '../../gridModel'
import { getFormat } from '../../format/registry'
import { enterHybrid } from '../hybrid'
import { deleteSecondRows, editSecondCells, moveSecondRow, resetSecondTotal, resolveSecondRows, toggleSecondMark, type TwoTables } from '../secondEdit'
import type { Bill, BillRow } from '../../types'

let n = 0
const newId = (): string => `id${++n}`
const row = (id: string, name: string, qty: string | null, rate: string | null, extra: Partial<BillRow> = {}): BillRow =>
  ({ id, idx: 0, nameRuns: name ? [{ t: name }] : [], qty, rate, totalOverride: null, gstRate: null, extras: {}, ...extra })

function hybridBill(): Bill {
  const b = createEmptyBill({ branchId: 'br1', formatId: 'gst', rowCount: 0, newId, now: '2026-10-14T10:00:00.000Z' })
  const base: Bill = { ...b, extraCols: [{ key: 'c1', header: 'Units', kind: 'units' }], rows: [
    row('p1', 'Pipe', '2', '50', { gstRate: '18', extras: { c1: { text: '5 box' } } }), row('p2', 'Elbow', '3', '10', { gstRate: '12' })
  ].map((r, i) => ({ ...r, idx: i })) }
  return enterHybrid(base, newId).bill
}
const two = (b: Bill): TwoTables => ({ rows: b.rows, hybrid: b.hybrid! })
const colsOf = (b: Bill) => buildGridColumns(getFormat('non_gst'), b.extraCols)
const disp = (): string => ''

describe('Phase 151 - second table edits', () => {
  it('a name edit changes only the second table', () => {
    const b = hybridBill()
    const id = b.hybrid!.rows[0]!.id
    const r = editSecondCells(two(b), [{ rowId: id, colKey: 'name', text: 'Pipe 2' }], colsOf(b), disp)!
    expect(r.hybrid.rows[0]!.nameRuns.map((x) => x.t).join('')).toBe('Pipe 2')
    expect(r.rows).toBe(b.rows)
  })
  it('an invalid numeric draft changes nothing', () => {
    const b = hybridBill()
    expect(editSecondCells(two(b), [{ rowId: b.hybrid!.rows[0]!.id, colKey: 'qty', text: '-' }], colsOf(b), disp)).toBeNull()
  })
  it('a shared extra cell is written to the primary twin and shows on both sides', () => {
    const b = hybridBill()
    const id = b.hybrid!.rows[1]!.id
    const r = editSecondCells(two(b), [{ rowId: id, colKey: 'c1', text: '7 box' }], colsOf(b), disp)!
    expect(r.rows[1]!.extras.c1?.text).toBe('7 box')
    expect(r.hybrid.rows[1]!.extras.c1).toBeUndefined()
    expect(resolveSecondRows(r.rows, r.hybrid)[1]!.extras.c1?.text).toBe('7 box')
  })
  it('an untwinned second row keeps its own extra cell', () => {
    const b = hybridBill()
    const t = two(b)
    const extra = row('s9', 'New', '1', '1')
    const t2: TwoTables = { rows: t.rows, hybrid: { ...t.hybrid, rows: [...t.hybrid.rows, extra] } }
    const r = editSecondCells(t2, [{ rowId: 's9', colKey: 'c1', text: 'x' }], colsOf(b), disp)!
    expect(r.hybrid.rows[2]!.extras.c1?.text).toBe('x')
    expect(r.rows).toBe(t.rows)
  })
  it('mark toggles the shared cell', () => {
    const b = hybridBill()
    const r = toggleSecondMark(two(b), b.hybrid!.rows[0]!.id, 'c1')!
    expect(r.marked).toBe(true)
    expect(r.t.rows[0]!.extras.c1?.marked).toBe(true)
  })
  it('reset total drops an override', () => {
    const b = hybridBill()
    const t = two(b)
    t.hybrid = { ...t.hybrid, rows: t.hybrid.rows.map((x, i) => (i === 0 ? { ...x, totalOverride: '99' } : x)) }
    expect(resetSecondTotal(t, t.hybrid.rows[0]!.id)!.hybrid.rows[0]!.totalOverride).toBeNull()
    expect(resetSecondTotal(two(b), t.hybrid.rows[1]!.id)).toBeNull()
  })
  it('delete and move keep ids (extras stay on positions)', () => {
    const b = hybridBill()
    const view = buildGridView(getFormat('non_gst'), resolveSecondRows(b.rows, b.hybrid!))
    const [a, c] = [b.hybrid!.rows[0]!.id, b.hybrid!.rows[1]!.id]
    const d = deleteSecondRows(two(b), view.bodyIds, new Set([a]), new Set(['c1']))!
    expect(d.hybrid.rows.map((x) => x.id)).toEqual([a, c])
    expect(d.hybrid.rows[0]!.nameRuns.map((x) => x.t).join('')).toBe('Elbow')
    const m = moveSecondRow(two(b), view.bodyIds, a, 1, new Set(['c1']))!
    expect(m.hybrid.rows.map((x) => x.id)).toEqual([a, c])
    expect(m.hybrid.rows[0]!.nameRuns.map((x) => x.t).join('')).toBe('Elbow')
  })
})
