import { describe, expect, it } from 'vitest'
import { deleteItemRows } from '../deleteRows'
import type { BillRow } from '../../types'

const mk = (n: number, name: string, extra?: string): BillRow => ({
  id: `r${n}`, idx: n, nameRuns: name ? [{ t: name }] : [], qty: name ? String(n) : null, rate: name ? String(n * 10) : null,
  totalOverride: n === 2 ? '99' : null, gstRate: null, extras: extra ? { e1: { text: extra, marked: n === 1 } } : {}
})
const rows = (): BillRow[] => [mk(0, 'A', 'x0'), mk(1, 'B', 'x1'), mk(2, 'C', 'x2'), mk(3, 'D', 'x3'), mk(4, '', ''), mk(5, '', '')]
const ids = (rs: BillRow[]) => rs.map((r) => r.id)
const names = (rs: BillRow[]) => rs.map((r) => r.nameRuns.map((x) => x.t).join(''))
const extras = (rs: BillRow[]) => rs.map((r) => r.extras['e1']?.text ?? '')
const E = new Set(['e1'])
const del = (rs: BillRow[], ...id: string[]) => deleteItemRows(rs, ids(rs), new Set(id), E)

describe('Phase 122 - deleteItemRows (extras stay on their positions)', () => {
  it('middle row: later item cells move up, extras and ids stay, same length', () => {
    const r = del(rows(), 'r1')!
    expect(names(r)).toEqual(['A', 'C', 'D', '', '', ''])
    expect(extras(r)).toEqual(['x0', 'x1', 'x2', 'x3', '', ''])
    expect(ids(r)).toEqual(ids(rows()))
    expect(r[1]!.rate).toBe('20')
    expect(r[1]!.totalOverride).toBe('99') // the manual total travels with its item
    expect(r[2]!.totalOverride).toBeNull()
  })
  it('first row, last item row, a blank row, the only row', () => {
    expect(names(del(rows(), 'r0')!)).toEqual(['B', 'C', 'D', '', '', ''])
    expect(names(del(rows(), 'r3')!)).toEqual(['A', 'B', 'C', '', '', ''])
    expect(names(del(rows(), 'r4')!)).toEqual(['A', 'B', 'C', 'D', '', ''])
    const one = [mk(0, 'Z', 'k')]
    const r = del(one, 'r0')!
    expect(names(r)).toEqual(['']); expect(r[0]!.qty).toBeNull(); expect(extras(r)).toEqual(['k'])
  })
  it('several rows at once (contiguous and not)', () => {
    expect(names(del(rows(), 'r0', 'r1')!)).toEqual(['C', 'D', '', '', '', ''])
    expect(names(del(rows(), 'r0', 'r2')!)).toEqual(['B', 'D', '', '', '', ''])
  })
  it('marked extras do not move (units / segments follow the positions)', () => {
    const r = del(rows(), 'r0')!
    expect(r[1]!.extras['e1']).toEqual({ text: 'x1', marked: true })
  })
  it('highlights: item-column styles move with the item, extra-column styles stay', () => {
    const rs = rows()
    rs[1] = { ...rs[1]!, cellStyle: { name: { hl: 1 }, e1: { hl: 1 } } }
    const r = del(rs, 'r0')!
    expect(r[0]!.cellStyle).toEqual({ name: { hl: 1 } }) // item style moved up to position 0; position 0 had no extra style
    expect(r[1]!.cellStyle).toEqual({ e1: { hl: 1 } }) // position 1 keeps its extra style; C had no item style
  })
  it('nothing to delete: null; unknown ids and adjustment rows (not body ids) are ignored', () => {
    const rs = rows()
    expect(deleteItemRows(rs, ids(rs), new Set(), E)).toBeNull()
    expect(deleteItemRows(rs, ids(rs), new Set(['nope']), E)).toBeNull()
    const adj = [...rs, { ...mk(6, 'adj'), id: 'adj1' }]
    const r = deleteItemRows(adj, ids(rs), new Set(['adj1', 'r0']), E)!
    expect(r[6]).toBe(adj[6]) // the adjustment row is untouched
    expect(names(r).slice(0, 3)).toEqual(['B', 'C', 'D'])
  })
  it('does not mutate its input', () => {
    const rs = rows(); const snap = JSON.stringify(rs)
    del(rs, 'r1'); expect(JSON.stringify(rs)).toBe(snap)
  })
})
