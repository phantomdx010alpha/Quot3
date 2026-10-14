import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyBill } from '@shared/billModel'
import { prepareBillForSave } from '@shared/billSave'
import { useBillStore } from '../billStore'
import { tableApi } from '../tableApi'
import type { BillRow } from '@shared/types'

const row = (id: string, name: string, qty: string | null, rate: string | null, extra: Partial<BillRow> = {}): BillRow =>
  ({ id, idx: 0, nameRuns: name ? [{ t: name }] : [], qty, rate, totalOverride: null, gstRate: null, extras: {}, ...extra })

function open(formatId: 'gst' | 'non_gst' = 'gst'): void {
  const b = createEmptyBill({ branchId: 'br1', formatId, rowCount: 0 })
  useBillStore.getState().loadBill({ ...b, extraCols: [{ key: 'c1', header: 'Units', kind: 'units' }], rows: [
    row('p1', 'Pipe', '2', '50', { gstRate: '18', extras: { c1: { text: '5 box' } } }), row('p2', 'Elbow', '3', '10', { gstRate: '12' })
  ].map((r, i) => ({ ...r, idx: i })) })
}
const names = (rows: readonly BillRow[]): string[] => rows.filter((r) => r.nameRuns.length > 0).map((r) => r.nameRuns.map((x) => x.t).join(''))

describe('Phase 151 - Hybrid in the bill store', () => {
  beforeEach(() => open())

  it('Alt+3 creates the second table once; a second call never overwrites it', () => {
    const s = useBillStore.getState()
    expect(s.second).toBeNull()
    expect(s.enterHybridView()).toBe('created')
    const first = useBillStore.getState().hybrid!.rows
    expect(useBillStore.getState().second?.formatId).toBe('non_gst')
    expect(names(useBillStore.getState().second!.rows)).toEqual(['Pipe', 'Elbow'])
    expect(useBillStore.getState().enterHybridView()).toBe('already')
    expect(useBillStore.getState().hybrid!.rows).toBe(first)
  })

  it('entering is ONE undo step and undo removes the second table', () => {
    useBillStore.getState().enterHybridView()
    expect(useBillStore.getState().undo()).toBe(true)
    expect(useBillStore.getState().hybrid).toBeUndefined()
    expect(useBillStore.getState().second).toBeNull()
    expect(useBillStore.getState().redo()).toBe(true)
    expect(useBillStore.getState().second).not.toBeNull()
  })

  it('the two tables are independent and each has its own totals', () => {
    useBillStore.getState().enterHybridView()
    const id = useBillStore.getState().hybrid!.rows[0]!.id
    expect(tableApi('second').setCellText(id, 'rate', '60')).toBe(true)
    const st = useBillStore.getState()
    expect(st.rows[0]!.rate).toBe('50')
    expect(st.hybrid!.rows[0]!.rate).toBe('60')
    expect(st.view.body.p1!.cells.total).toBe('100.00')
    expect(st.second!.view.body[id]!.cells.total).toBe('120.00')
    // the primary side is unchanged
    expect(tableApi('primary').view.body.p1).toBeDefined()
  })

  it('a shared extra cell edited on the second side shows on the primary side', () => {
    useBillStore.getState().enterHybridView()
    const id = useBillStore.getState().hybrid!.rows[1]!.id
    tableApi('second').setCellText(id, 'c1', '9 box')
    expect(useBillStore.getState().rows[1]!.extras.c1?.text).toBe('9 box')
    expect(useBillStore.getState().second!.rows[1]!.extras.c1?.text).toBe('9 box')
  })

  it('second-table edits undo with the same history', () => {
    useBillStore.getState().enterHybridView()
    const id = useBillStore.getState().hybrid!.rows[0]!.id
    tableApi('second').setCellText(id, 'qty', '7')
    expect(useBillStore.getState().hybrid!.rows[0]!.qty).toBe('7')
    useBillStore.getState().undo()
    expect(useBillStore.getState().hybrid!.rows[0]!.qty).toBe('2')
  })

  it('leaving Hybrid keeps the second table and switches the primary layout', () => {
    useBillStore.getState().enterHybridView()
    expect(useBillStore.getState().leaveHybridView('non_gst')).toBe(true)
    const st = useBillStore.getState()
    expect(st.formatId).toBe('non_gst')
    expect(st.hybrid?.active).toBe(false)
    expect(st.hybrid!.rows.length).toBeGreaterThan(0)
    expect(useBillStore.getState().enterHybridView()).toBe('shown')
    expect(useBillStore.getState().formatId).toBe('gst')
  })

  it('save keeps the second table, trimmed of blank padding, and it reloads', () => {
    useBillStore.getState().enterHybridView()
    const saved = prepareBillForSave(useBillStore.getState().toBill())
    expect(saved.hybrid!.rows).toHaveLength(2)
    useBillStore.getState().loadBill(saved)
    expect(useBillStore.getState().second).not.toBeNull()
    expect(names(useBillStore.getState().second!.rows)).toEqual(['Pipe', 'Elbow'])
  })

  it('re-copy replaces the target table only on the explicit action', () => {
    useBillStore.getState().enterHybridView()
    const id = useBillStore.getState().hybrid!.rows[0]!.id
    tableApi('second').setCellText(id, 'name', 'Changed')
    expect(useBillStore.getState().recopyTable('non_gst')).toBe(true)
    expect(names(useBillStore.getState().second!.rows)).toEqual(['Pipe', 'Elbow'])
  })
})
