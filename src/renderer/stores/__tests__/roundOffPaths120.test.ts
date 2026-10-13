// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBillStore } from '../billStore'
import { useBehaviourStore } from '../behaviourStore'
import { createSession, openBillForEdit } from '../createSession'
import { createEmptyBill } from '@shared/billModel'
import { grandTotalOf } from '@shared/calc/calcPanel'
import { billToTsv } from '@shared/tsv/billTsv'
import type { Bill } from '@shared/types'

// Phase 120: round-off on every renderer path. Totals are decimal strings; the setting is read only through the stores.
const grand = (): string | null => grandTotalOf(useBillStore.getState().view.footer)
function fill(b: Bill): Bill {
  const st = useBillStore.getState()
  st.loadBill(b)
  const id = useBillStore.getState().rows[0]!.id
  st.setCellTexts([{ rowId: id, colKey: 'name', text: 'Ruby' }, { rowId: id, colKey: 'rate', text: '100.30' }, { rowId: id, colKey: 'qty', text: '1' }])
  return st.toBill()
}
const mk = (roundOff?: boolean): Bill => createEmptyBill({ branchId: 'local', rowCount: 2, ...(roundOff === undefined ? {} : { roundOff }) })
const withBridge = (bill: Bill): void => { ;(window as unknown as { quot3: unknown }).quot3 = { bills: { getForEdit: vi.fn(async () => ({ ok: true, data: bill })) } } }

beforeEach(() => { useBehaviourStore.setState({ roundOff: true }); createSession.set(null) })
afterEach(() => { delete (window as unknown as { quot3?: unknown }).quot3 })

describe('Phase 120 - new bill', () => {
  it('setting ON: a new bill carries the flag and the grand total is a whole rupee', () => {
    const b = fill(mk(useBehaviourStore.getState().roundOff))
    expect(b.roundOff).toBe(1)
    expect(grand()).toBe('100.00')
  })
  it('setting OFF: the total is unchanged', () => {
    useBehaviourStore.setState({ roundOff: false })
    fill(mk(useBehaviourStore.getState().roundOff))
    expect(grand()).toBe('100.30')
  })
})

describe('Phase 120 - open for edit follows the setting (what Save will stamp)', () => {
  it('old bill (flag 0) + setting ON: shows the rounded total, same as the TSV copy, and is NOT dirty', async () => {
    const old = fill(mk(false))
    expect(grand()).toBe('100.30')
    withBridge({ ...old, id: 'old-1', roundOff: undefined } as Bill)
    expect(await openBillForEdit('old-1')).toBe(true)
    expect(grand()).toBe('100.00')
    expect(useBillStore.getState().dirty).toBe(false)
    expect(useBillStore.getState().toBill().roundOff).toBe(1)
    expect(billToTsv(useBillStore.getState().toBill()).text).toContain('100.00')
  })
  it('flag 1 + setting OFF: shows the exact total (Save would stamp 0)', async () => {
    const b = fill(mk(true))
    useBehaviourStore.setState({ roundOff: false })
    withBridge({ ...b, id: 'r-1' })
    await openBillForEdit('r-1')
    expect(grand()).toBe('100.30')
    expect(useBillStore.getState().dirty).toBe(false)
  })
  it('save result stamps the flag and the grid follows it (applySaved)', () => {
    fill(mk(false))
    expect(grand()).toBe('100.30')
    const st = useBillStore.getState()
    st.applySaved({ id: st.billId ?? '', poNumber: 'Q3-1', poSeq: 1, revision: 1, partyId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), roundOff: 1 })
    expect(grand()).toBe('100.00')
  })
})
