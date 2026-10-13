import { afterEach, describe, expect, it } from 'vitest'
import type { BillRecord } from '../../../shared/billModel'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { billPayloadSchema } from '../../ipc/bills'
import { createBillService, type SaveBillInput } from '../billService'
import { blankRow, row } from '../../../shared/__fixtures__/bills'

const open: TestDb[] = []
afterEach(() => open.splice(0).forEach((t) => t.cleanup()))

let n = 0
function mk() {
  const t = openTestDb()
  open.push(t)
  const sqlite = t.handle.sqlite
  const bills = createBillRepo(sqlite)
  const svc = createBillService({ sqlite, bills, parties: createPartyRepo(sqlite) }, { newId: () => `fc-${++n}`, now: () => new Date(Date.UTC(2026, 9, 10, 10, 0, n)) })
  return { svc, bills }
}
const input = (id: string, extra: Partial<SaveBillInput['bill']> = {}): SaveBillInput => ({
  bill: {
    id, party: { name: 'Ruby Traders', phone: '', address: '', transport: '' }, formatId: 'non_gst',
    extraCols: [{ key: 'c1', header: 'Col 1', kind: 'units' }], paperOverride: null, billDate: '2026-10-10',
    rows: [row('Pen', '3', '10'), blankRow()], ...extra
  }
})

describe('Phase 79 - free cells persist through the real save / read path', () => {
  it('saves footer cells and trimmed tail rows, reads them back, caches the paper row count nowhere (derived)', () => {
    const { svc, bills } = mk()
    svc.save(input('a', {
      footerExtras: { grandTotal: { c1: { text: '12 pcs' } } },
      tailRows: [{ extras: { c1: { text: '5' } } }, { extras: {} }, { extras: { c1: { text: '' } } }]
    }))
    const rec = bills.getRecord('a') as BillRecord
    expect(JSON.parse(rec.footerExtrasJson!)).toEqual({ grandTotal: { c1: { text: '12 pcs' } } })
    expect(JSON.parse(rec.tailRowsJson!)).toEqual([{ extras: { c1: { text: '5' } } }]) // trailing empties trimmed
    const got = svc.getForEdit('a')
    expect(got.footerExtras).toEqual({ grandTotal: { c1: { text: '12 pcs' } } })
    expect(got.tailRows).toEqual([{ extras: { c1: { text: '5' } } }])
  })
  it('a re-save without them clears them; a bill saved without them stores {} and []', () => {
    const { svc, bills } = mk()
    svc.save(input('b', { tailRows: [{ extras: { c1: { text: 'x' } } }] }))
    svc.save({ ...input('b'), expectedRevision: 1 })
    expect((bills.getRecord('b') as BillRecord).tailRowsJson).toBe('[]')
    svc.save(input('c'))
    expect((bills.getRecord('c') as BillRecord).footerExtrasJson).toBe('{}')
  })
  it('the IPC payload schema accepts them and rejects unknown footer keys', () => {
    const p = input('d', { footerExtras: { grandTotal: { c1: { text: 'a' } } }, tailRows: [{ extras: { c1: { text: 'a' } } }] }).bill
    expect(billPayloadSchema.safeParse({ ...p, rows: [] }).success).toBe(true)
    expect(billPayloadSchema.safeParse({ ...p, rows: [], footerExtras: { bogus: {} } }).success).toBe(false)
  })
})
