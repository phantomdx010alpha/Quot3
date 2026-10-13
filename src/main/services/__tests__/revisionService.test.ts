import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createBillService, type SaveBillInput } from '../billService'
import { createRevisionService } from '../revisionService'
import { revisionHandlers } from '../../ipc/revisions'
import { diffBills } from '../../../shared/diff/billDiff'
import { REVISION_MAX_PER_BILL } from '../../../shared/constants'
import { blankRow, row } from '../../../shared/__fixtures__/bills'
import type { BillRow } from '../../../shared/types'

const open: TestDb[] = []
afterEach(() => open.splice(0).forEach((t) => t.cleanup()))

let n = 0
function mk(opts: { writable?: boolean } = {}) {
  const t = openTestDb()
  open.push(t)
  const sqlite = t.handle.sqlite
  const bills = createBillRepo(sqlite)
  let clock = 0
  const svc = createBillService(
    { sqlite, bills, parties: createPartyRepo(sqlite) },
    { ...opts, newId: () => `gen-${++n}`, now: () => new Date(Date.UTC(2026, 9, 8, 10, 0, clock++)) }
  )
  return { svc, sqlite, bills, revs: createRevisionService({ bills }) }
}

const pen = (): BillRow => ({ ...row('Pen', '10', '9'), id: 'row-pen' })
const book = (): BillRow => ({ ...row('Book', '2', '45.50'), id: 'row-book' })
const input = (id: string, over: Partial<SaveBillInput['bill']> = {}, expectedRevision?: number): SaveBillInput => ({
  bill: {
    id, party: { name: 'Ruby Traders', phone: '98450 11001', address: '1 Main Rd', transport: 'VRL' }, formatId: 'non_gst', extraCols: [],
    paperOverride: null, billDate: '2026-10-08', rows: [pen(), book(), blankRow(), blankRow()], ...over
  },
  ...(expectedRevision !== undefined ? { expectedRevision } : {})
})

describe('revisionService.list / get', () => {
  it('lists every save newest first with party, date and grand total; only the newest is current', () => {
    const { svc, revs } = mk()
    svc.save(input('b1'))
    svc.save(input('b1', { rows: [pen(), { ...book(), qty: '4' }] }, 1))
    const l = revs.list('b1')
    expect(l.map((r) => r.revision)).toEqual([2, 1])
    expect(l[0]).toMatchObject({ revision: 2, partyName: 'Ruby Traders', billDate: '2026-10-08', grandTotal: '272.00', itemRowCount: 2, isCurrent: true })
    expect(l[1]).toMatchObject({ revision: 1, grandTotal: '181.00', isCurrent: false })
  })

  it('get returns that revision as a full bill (rows keep ids)', () => {
    const { svc, revs } = mk()
    svc.save(input('b1'))
    svc.save(input('b1', { rows: [pen()] }, 1))
    const r1 = revs.get('b1', 1)
    expect(r1.bill.rows.map((r) => r.id)).toEqual(['row-pen', 'row-book'])
    expect(revs.get('b1', 2).bill.rows).toHaveLength(1)
  })

  it('a deleted or unknown bill, or a revision that is not stored, is NOT_FOUND', () => {
    const { svc, revs } = mk()
    svc.save(input('b1'))
    expect(() => revs.list('nope')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
    expect(() => revs.get('b1', 9)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
    svc.delete(['b1'])
    expect(() => revs.list('b1')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
  })

  it('after delete + restore (revision bumped, no new row) nothing is marked current', () => {
    const { svc, sqlite, revs } = mk()
    svc.save(input('b1'))
    svc.delete(['b1'])
    sqlite.prepare('UPDATE bills SET deleted_at = NULL, revision = revision + 1').run()
    expect(revs.list('b1').map((r) => r.isCurrent)).toEqual([false])
  })
})

describe('revisionService.restoreToDraft', () => {
  it('returns the revision content under the bill\'s CURRENT identity and revision, and writes nothing', () => {
    const { svc, sqlite, revs } = mk()
    const first = svc.save(input('b1'))
    svc.save(input('b1', { rows: [pen(), { ...book(), qty: '4' }], party: { name: 'Ruby Traders Pvt', phone: '1', address: 'x', transport: 'y' }, billDate: '2026-10-09' }, 1))
    const before = JSON.stringify([sqlite.prepare('SELECT * FROM bills').all(), sqlite.prepare('SELECT * FROM bill_rows').all(), sqlite.prepare('SELECT * FROM bill_revisions').all()])

    const r = revs.restoreToDraft('b1', 1)

    expect(r.fromRevision).toBe(1)
    expect(r.draft).toMatchObject({ id: 'b1', poNumber: first.poNumber, poSeq: first.poSeq, revision: 2, billDate: '2026-10-08', deletedAt: null })
    expect(r.draft.party.name).toBe('Ruby Traders')
    expect(r.draft.rows.find((x) => x.id === 'row-book')?.qty).toBe('2')
    // The baseline is what is stored now, so the editor sees the restore as unsaved changes.
    expect(r.baseline).toMatchObject({ revision: 2, billDate: '2026-10-09' })
    expect(r.baseline.rows.find((x) => x.id === 'row-book')?.qty).toBe('4')
    const d = diffBills(r.baseline, r.draft)
    expect(d.identical).toBe(false)
    expect(d.party.map((c) => c.field)).toContain('party.name')
    expect(d.bill.map((c) => c.field)).toContain('billDate')
    expect(d.rows).toHaveLength(1)
    // Nothing was written (restore never overwrites).
    expect(JSON.stringify([sqlite.prepare('SELECT * FROM bills').all(), sqlite.prepare('SELECT * FROM bill_rows').all(), sqlite.prepare('SELECT * FROM bill_revisions').all()])).toBe(before)
  })

  it('needs no write access (the service only reads, so a read-only database still restores)', () => {
    const { svc, bills } = mk()
    svc.save(input('b1'))
    svc.save(input('b1', { rows: [pen()] }, 1))
    const ro = createRevisionService({ bills })
    expect(ro.restoreToDraft('b1', 1).draft.rows).toHaveLength(2)
  })

  it('saving the restored draft is a normal edit: revision + 1 and a NEW revision row, old rows untouched', () => {
    const { svc, revs } = mk()
    svc.save(input('b1'))
    svc.save(input('b1', { rows: [pen()] }, 1))
    const { draft } = revs.restoreToDraft('b1', 1)
    const saved = svc.save({ bill: { id: draft.id, party: draft.party, formatId: draft.formatId, extraCols: draft.extraCols, paperOverride: draft.paperOverride, billDate: draft.billDate, rows: draft.rows }, expectedRevision: draft.revision })
    expect(saved.revision).toBe(3)
    expect(revs.list('b1').map((r) => r.revision)).toEqual([3, 2, 1])
    expect(revs.get('b1', 3).bill.rows).toHaveLength(2)
  })

  it('a damaged snapshot is a DB_ERROR, not a crash', () => {
    const { svc, sqlite, revs } = mk()
    svc.save(input('b1'))
    svc.save(input('b1', { rows: [pen()] }, 1))
    sqlite.prepare("UPDATE bill_revisions SET snapshot_json = '{oops' WHERE revision = 1").run()
    expect(() => revs.get('b1', 1)).toThrow(expect.objectContaining({ code: 'DB_ERROR' }))
    expect(() => revs.restoreToDraft('b1', 1)).toThrow(expect.objectContaining({ code: 'DB_ERROR' }))
    expect(revs.list('b1')).toHaveLength(2) // the list still reads
  })
})

describe('revision cap (REVISION_MAX_PER_BILL)', () => {
  it('keeps the newest 50; the oldest are NOT_FOUND; other bills are untouched', () => {
    expect(REVISION_MAX_PER_BILL).toBe(50)
    const { svc, revs } = mk()
    svc.save(input('other', { rows: [row('Pen', '1', '1')] }))
    svc.save(input('b1'))
    for (let i = 0; i < 54; i++) svc.save(input('b1', { rows: [pen(), { ...book(), qty: String(i + 3) }] }))
    const l = revs.list('b1')
    expect(l).toHaveLength(50)
    expect(l[0]!.revision).toBe(55)
    expect(l[49]!.revision).toBe(6)
    expect(() => revs.get('b1', 5)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
    expect(revs.list('other')).toHaveLength(1)
  })

  it('stays at 50 even when the revision number has gaps (delete / restore bump it without a row)', () => {
    const { svc, sqlite, revs } = mk()
    svc.save(input('b1'))
    for (let i = 0; i < 49; i++) svc.save(input('b1'))
    sqlite.prepare('UPDATE bills SET revision = revision + 10').run() // as if delete + restore cycles happened
    svc.save(input('b1'))
    svc.save(input('b1'))
    expect(revs.list('b1')).toHaveLength(50)
  })
})

describe('revisions IPC', () => {
  it('validates strictly and returns the envelope', async () => {
    const { svc, revs } = mk()
    svc.save(input('b1'))
    const h = revisionHandlers(revs)
    expect(await h['revisions:list']!({ billId: 'b1' })).toMatchObject({ ok: true })
    expect(await h['revisions:list']!({ billId: '' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await h['revisions:get']!({ billId: 'b1', revision: 0 })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await h['revisions:get']!({ billId: 'b1', revision: 1, extra: 1 })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await h['revisions:restoreToDraft']!({ billId: 'b1', revision: 1 })).toMatchObject({ ok: true, data: { fromRevision: 1 } })
    expect(await h['revisions:restoreToDraft']!({ billId: 'b1', revision: 7 })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })
})
