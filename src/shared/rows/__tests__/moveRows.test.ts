import { describe, expect, it } from 'vitest'
import { moveDestination, moveItemRow } from '../moveRows'
import { deleteItemRows } from '../deleteRows'
import { sameContent } from '../../sync/conflict'
import type { BillRow } from '../../types'

const mk = (n: number, name: string, extra?: string): BillRow => ({
  id: `r${n}`, idx: n, nameRuns: name ? [{ t: name }] : [], qty: name ? String(n) : null, rate: name ? String(n * 10) : null,
  totalOverride: n === 2 ? '99' : null, gstRate: null, extras: extra ? { e1: { text: extra, marked: n === 1 } } : {}
})
const rows = (): BillRow[] => [mk(0, 'A', 'x0'), mk(1, 'B', 'x1'), mk(2, 'C', 'x2'), mk(3, 'D', 'x3'), mk(4, '', ''), mk(5, '', '')]
const ids = (rs: readonly BillRow[]) => rs.map((r) => r.id)
const names = (rs: readonly BillRow[]) => rs.map((r) => r.nameRuns.map((x) => x.t).join(''))
const extras = (rs: readonly BillRow[]) => rs.map((r) => r.extras['e1']?.text ?? '')
const E = new Set(['e1'])
const mv = (rs: BillRow[], id: string, t: Parameters<typeof moveDestination>[3]) => {
  const to = moveDestination(rs, ids(rs), id, t)
  return to === null ? null : moveItemRow(rs, ids(rs), id, to, E)
}

describe('Phase 123 - moveItemRow (extras stay on their positions)', () => {
  it('down / up swap neighbouring items; ids, extras and length stay', () => {
    const d = mv(rows(), 'r1', 'down')!
    expect(names(d)).toEqual(['A', 'C', 'B', 'D', '', ''])
    expect(extras(d)).toEqual(['x0', 'x1', 'x2', 'x3', '', ''])
    expect(ids(d)).toEqual(ids(rows()))
    expect(d[1]!.totalOverride).toBe('99') // manual total travels with its item
    expect(d[2]!.rate).toBe('10')
    expect(names(mv(rows(), 'r2', 'up')!)).toEqual(['A', 'C', 'B', 'D', '', ''])
  })
  it('to top and to bottom shift the rows in between', () => {
    expect(names(mv(rows(), 'r2', 'top')!)).toEqual(['C', 'A', 'B', 'D', '', ''])
    expect(names(mv(rows(), 'r0', 'bottom')!)).toEqual(['B', 'C', 'D', 'A', '', ''])
  })
  it('no-ops: first row up, last item row down (never into blank rows), blank-only bill, unknown id', () => {
    expect(mv(rows(), 'r0', 'up')).toBeNull()
    expect(mv(rows(), 'r3', 'down')).toBeNull()
    expect(mv(rows(), 'r3', 'bottom')).toBeNull()
    expect(mv([mk(0, '', ''), mk(1, '', '')], 'r0', 'down')).toBeNull()
    expect(moveDestination(rows(), ids(rows()), 'nope', 'up')).toBeNull()
  })
  it('marked extras and highlights split: item highlights move, extra highlights stay', () => {
    const rs = rows()
    rs[1] = { ...rs[1]!, cellStyle: { name: { hl: 1 as const }, e1: { hl: 1 as const } } }
    const d = mv(rs, 'r1', 'down')!
    expect(d[2]!.cellStyle).toEqual({ name: { hl: 1 } })
    expect(d[1]!.cellStyle).toEqual({ e1: { hl: 1 } })
    expect(d[1]!.extras['e1']).toEqual({ text: 'x1', marked: true })
  })
  it('per-word formatting travels with the item', () => {
    const rs = rows()
    rs[0] = { ...rs[0]!, nameRuns: [{ t: 'Red ', r: 1 }, { t: 'bold', b: 1 }] }
    const d = mv(rs, 'r0', 'down')!
    expect(d[1]!.nameRuns).toEqual([{ t: 'Red ', r: 1 }, { t: 'bold', b: 1 }])
  })
  it('does not mutate its input; move there and back restores the original', () => {
    const rs = rows(); const copy = JSON.stringify(rs); const orig = rows()
    const d = mv(rs, 'r1', 'down')!
    expect(JSON.stringify(rs)).toBe(copy)
    expect(mv(d, 'r2', 'up')).toEqual(orig)
  })
  it('moveItemRow rejects bad targets', () => {
    const rs = rows()
    expect(moveItemRow(rs, ids(rs), 'r1', 1, E)).toBeNull()
    expect(moveItemRow(rs, ids(rs), 'r1', 99, E)).toBeNull()
    expect(moveItemRow(rs, ids(rs), 'zz', 0, E)).toBeNull()
  })
  it('works with Phase 122 delete: move then delete gives the expected order', () => {
    const d = mv(rows(), 'r0', 'bottom')! // B C D A
    expect(names(deleteItemRows(d, ids(d), new Set(['r1']), E)!)).toEqual(['B', 'D', 'A', '', '', ''])
  })
})

describe('Phase 123 - a move is a change for sync (sameContent) and for the diff', () => {
  const rec = (r: BillRow) => ({
    idx: r.idx, nameRunsJson: JSON.stringify(r.nameRuns), namePlain: r.nameRuns.map((x) => x.t).join(''), qty: r.qty, rate: r.rate,
    totalOverride: r.totalOverride, gstRate: r.gstRate, extrasJson: JSON.stringify(r.extras), cellStyleJson: JSON.stringify(r.cellStyle ?? {})
  })
  const bill = {
    branchId: 'b', poSeq: 1, poNumber: 'P1', partySnapshotJson: '{}', formatId: 'f', extraColsJson: '[]', paperOverride: null, roundOff: 0 as const,
    footerExtrasJson: '{}', tailRowsJson: '[]', billDate: '2026-10-11', deletedAt: null
  }
  it('sameContent: moved bill differs, same bill equals', () => {
    const a = rows(); const b = mv(rows(), 'r1', 'down')!
    expect(sameContent({ bill, rows: a.map(rec) }, { bill, rows: a.map(rec) })).toBe(true)
    expect(sameContent({ bill, rows: a.map(rec) }, { bill, rows: b.map(rec) })).toBe(false)
  })
})
