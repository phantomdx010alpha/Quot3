import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyBill } from '@shared/billModel'
import { useBillStore } from '../billStore'
import { applyCaseToNames } from '../caseNames'
import { toggleBold } from '@shared/richtext/runs'
import type { BillRow } from '@shared/types'

const row = (id: string, name: string, qty: string | null, rate: string | null, runs?: BillRow['nameRuns']): BillRow =>
  ({ id, idx: 0, nameRuns: runs ?? (name ? [{ t: name }] : []), qty, rate, totalOverride: null, gstRate: null, extras: {} })
const st = () => useBillStore.getState()
const names = (rows: readonly BillRow[]): string[] => rows.filter((r) => r.nameRuns.length > 0).map((r) => r.nameRuns.map((x) => x.t).join(''))

function open(): void {
  const b = createEmptyBill({ branchId: 'br1', formatId: 'non_gst', rowCount: 0 })
  st().loadBill({ ...b, rows: [row('p1', 'Copper wire', '2', '50', toggleBold([{ t: 'Copper wire' }], 0, 6)), row('p2', 'Elbow joint', '3', '10'), row('p3', 'Tank', '1', '5')].map((r, i) => ({ ...r, idx: i })) })
}

describe('Phase 234 - Case button on the bill store', () => {
  beforeEach(() => open())

  it('UPPER then lower then UPPER; names only, other columns untouched, bold kept', () => {
    const before = st().rows.map((r) => [r.qty, r.rate])
    expect(applyCaseToNames(null)).toEqual({ mode: 'upper', changed: 3 })
    expect(names(st().rows)).toEqual(['COPPER WIRE', 'ELBOW JOINT', 'TANK'])
    expect(st().rows[0]!.nameRuns.some((r) => r.b === 1 && r.t === 'COPPER')).toBe(true)
    expect(st().rows.map((r) => [r.qty, r.rate])).toEqual(before)
    expect(applyCaseToNames(null).mode).toBe('lower')
    expect(names(st().rows)).toEqual(['copper wire', 'elbow joint', 'tank'])
    expect(applyCaseToNames(null).mode).toBe('upper')
  })
  it('is ONE undo step (and one redo), and nothing to change records no entry', () => {
    expect(st().canUndo).toBe(false)
    applyCaseToNames(null)
    st().undo()
    expect(names(st().rows)).toEqual(['Copper wire', 'Elbow joint', 'Tank'])
    expect(st().canUndo).toBe(false)
    st().redo()
    expect(names(st().rows)).toEqual(['COPPER WIRE', 'ELBOW JOINT', 'TANK'])
    st().undo(); st().undo()
    expect(names(st().rows)).toEqual(['Copper wire', 'Elbow joint', 'Tank'])
    // all names already UPPER -> the press makes them lower (a change), never an empty entry
    expect(applyCaseToNames({ side: 'primary', ids: [] })).toEqual({ mode: 'upper', changed: 0 })
  })
  it('a selection changes only those rows', () => {
    const r = applyCaseToNames({ side: 'primary', ids: ['p2'] })
    expect(r).toEqual({ mode: 'upper', changed: 1 })
    expect(names(st().rows)).toEqual(['Copper wire', 'ELBOW JOINT', 'Tank'])
  })
  it('Hybrid: the second table rows are included, and it is still one undo step', () => {
    expect(st().enterHybridView()).toBe('created')
    const afterEnter = st().undoLabel
    applyCaseToNames(null)
    expect(names(st().rows)).toEqual(['COPPER WIRE', 'ELBOW JOINT', 'TANK'])
    expect(names(st().second!.rows)).toEqual(['COPPER WIRE', 'ELBOW JOINT', 'TANK'])
    st().undo()
    expect(names(st().rows)).toEqual(['Copper wire', 'Elbow joint', 'Tank'])
    expect(names(st().second!.rows)).toEqual(['Copper wire', 'Elbow joint', 'Tank'])
    expect(st().undoLabel).toBe(afterEnter)
  })
  it('a selection in one table leaves the other table alone', () => {
    st().enterHybridView()
    const secondId = st().second!.rows[1]!.id
    applyCaseToNames({ side: 'second', ids: [secondId] })
    expect(names(st().rows)).toEqual(['Copper wire', 'Elbow joint', 'Tank'])
    expect(names(st().second!.rows)).toEqual(['Copper wire', 'ELBOW JOINT', 'Tank'])
  })
})
