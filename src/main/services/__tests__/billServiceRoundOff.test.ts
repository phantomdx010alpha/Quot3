import { afterEach, describe, expect, it } from 'vitest'
import type { BillRecord } from '../../../shared/billModel'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createBillService, type SaveBillInput } from '../billService'
import { blankRow, row } from '../../../shared/__fixtures__/bills'

const open: TestDb[] = []
afterEach(() => open.splice(0).forEach((t) => t.cleanup()))

let n = 0
function mk(roundOn: { v: boolean } | undefined) {
  const t = openTestDb()
  open.push(t)
  const sqlite = t.handle.sqlite
  const bills = createBillRepo(sqlite)
  const svc = createBillService(
    { sqlite, bills, parties: createPartyRepo(sqlite) },
    { newId: () => `ro-${++n}`, now: () => new Date(Date.UTC(2026, 9, 10, 10, 0, n)), ...(roundOn ? { roundOff: () => roundOn.v } : {}) }
  )
  return { svc, bills }
}
const input = (id: string): SaveBillInput => ({
  bill: {
    id, party: { name: 'Ruby Traders', phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null,
    billDate: '2026-10-10', rows: [row('Pen', '3', '33.33'), blankRow()]
  }
})
const grand = (bills: ReturnType<typeof createBillRepo>, id: string): string => JSON.parse((bills.getRecord(id) as BillRecord).totalsJson).grandTotal

describe('Phase 77 - the server stamps round_off from the setting on every save', () => {
  it('setting ON: flag 1, grand total rounded, result carries the flag', () => {
    const { svc, bills } = mk({ v: true })
    const r = svc.save(input('a'))
    expect(r.roundOff).toBe(1)
    expect((bills.getRecord('a') as BillRecord).roundOff).toBe(1)
    expect(grand(bills, 'a')).toBe('100.00')
  })
  it('setting OFF: flag 0, exact total', () => {
    const { svc, bills } = mk({ v: false })
    const r = svc.save(input('b'))
    expect(r.roundOff).toBe(0)
    expect((bills.getRecord('b') as BillRecord).roundOff).toBe(0)
    expect(grand(bills, 'b')).toBe('99.99')
  })
  it('no setting wired (tests / tools): off', () => {
    const { svc, bills } = mk(undefined)
    expect(svc.save(input('c')).roundOff).toBe(0)
    expect(grand(bills, 'c')).toBe('99.99')
  })
  it('an old bill keeps its totals until it is re-saved with the setting on', () => {
    const s = { v: false }
    const { svc, bills } = mk(s)
    svc.save(input('d'))
    s.v = true
    expect((bills.getRecord('d') as BillRecord).roundOff).toBe(0) // changing the setting alone touches nothing
    expect(grand(bills, 'd')).toBe('99.99')
    const r = svc.save({ ...input('d'), expectedRevision: 1 })
    expect(r.roundOff).toBe(1)
    expect(grand(bills, 'd')).toBe('100.00')
    expect(svc.getForEdit('d').roundOff).toBe(1)
  })
  it('the client cannot choose the flag (an extra roundOff on the payload is ignored)', () => {
    const { svc, bills } = mk({ v: false })
    const i = input('e')
    ;(i.bill as unknown as { roundOff: number }).roundOff = 1
    svc.save(i)
    expect((bills.getRecord('e') as BillRecord).roundOff).toBe(0)
  })
  it('the revision snapshot carries the flag', () => {
    const { svc, bills } = mk({ v: true })
    svc.save(input('f'))
    const snap = JSON.parse(bills.getRevision('f', 1)!.snapshotJson)
    expect(snap.bill.roundOff).toBe(1)
  })
})
