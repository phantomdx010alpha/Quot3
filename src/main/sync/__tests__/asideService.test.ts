import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createSyncRecordRepo } from '../../db/syncRecordRepo'
import { createBillService } from '../../services/billService'
import { createAsideService } from '../asideService'
import { encodeRecord, type DecodedRecord, type RawRecord } from '../../../shared/sync/codecV2'
import { blankRow, row } from '../../../shared/__fixtures__/bills'
import { serializeBill } from '../../../shared/billModel'
import type { Bill } from '../../../shared/types'

const open: TestDb[] = []
afterEach(() => open.splice(0).forEach((t) => t.cleanup()))

const mkBill = (id: string): Bill => ({
  id, branchId: 'br1', poSeq: 1, poNumber: 'Q3-0001', partyId: null, party: { name: 'Ruby', phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [],
  paperOverride: null, billDate: '2026-10-08', rows: [row('Pen', '10', '9'), blankRow()], revision: 1, createdAt: 'a', updatedAt: 'a', deletedAt: null, syncState: 'local_only'
})
function raw(id: string, over: Partial<RawRecord> = {}): RawRecord {
  const s = serializeBill(mkBill(id))
  const { syncState: _s, ...rec } = s.bill
  void _s
  const e = encodeRecord({ kind: 'bill', recId: id, data: { bill: rec, rows: s.rows }, deleted: false, editedAt: '2026-10-12T00:00:00.000Z', appVer: '9.9.9' })
  return { kind: 'bill', recId: id, version: 1, serverSeq: 3, payload: e.payload, schemaVer: e.schemaVer, minReaderVer: e.minReaderVer, appVer: e.appVer, editedAt: e.editedAt, deleted: false, ...over }
}
function setup(readerVer = 1) {
  const t = openTestDb(); open.push(t)
  const repo = createSyncRecordRepo(t.handle.sqlite)
  const applied: DecodedRecord[] = []
  let ver = readerVer
  let failNext = false
  const svc = createAsideService({
    repo, readerVer: () => ver, now: () => new Date('2026-10-12T08:00:00Z'),
    apply: (r) => { if (failNext) { failNext = false; throw new Error('boom') } applied.push(r) }
  })
  return { t, repo, svc, applied, setVer: (n: number) => { ver = n }, failNext: () => { failNext = true } }
}

describe('asideService', () => {
  it('a record from a newer app is set aside: stored untouched, not applied, counted', () => {
    const { svc, repo, applied } = setup()
    const r = raw('b1', { minReaderVer: 2, schemaVer: 2, payload: { v: 2, kind: 'bill', deleted: false, bill: 'a shape this app cannot read' } })
    expect(svc.ingest(r).outcome).toBe('aside')
    expect(applied).toHaveLength(0)
    expect(svc.count()).toBe(1)
    expect(svc.countsByKind()).toEqual({ bill: 1 })
    const stored = repo.getAside('bill', 'b1')!
    expect(stored).toMatchObject({ version: 1, minReaderVer: 2, seenAt: '2026-10-12T08:00:00.000Z' })
    expect(JSON.parse(stored.payloadJson).payload).toEqual(r.payload) // nothing stripped
    expect(svc.list()).toEqual([{ kind: 'bill', recId: 'b1', version: 1, minReaderVer: 2, seenAt: '2026-10-12T08:00:00.000Z' }])
  })

  it('a readable record is returned for the caller to apply and is not set aside', () => {
    const { svc } = setup()
    const r = svc.ingest(raw('b1'))
    expect(r.outcome).toBe('apply')
    expect(svc.count()).toBe(0)
  })

  it('an invalid record is reported, not set aside', () => {
    const { svc } = setup()
    expect(svc.ingest(raw('b1', { payload: 'junk' })).outcome).toBe('invalid')
    expect(svc.count()).toBe(0)
  })

  it('local edit and delete of an aside bill are blocked; other bills are not', () => {
    const { t, repo, svc } = setup()
    svc.ingest(raw('b1', { minReaderVer: 2 }))
    expect(() => svc.assertEditable('bill', 'b1')).toThrow(expect.objectContaining({ code: 'RECORD_ASIDE' }))
    expect(() => svc.assertEditable('bill', 'other')).not.toThrow()
    const sqlite = t.handle.sqlite
    const bs = createBillService({ sqlite, bills: createBillRepo(sqlite), parties: createPartyRepo(sqlite) }, { isAside: (id) => repo.isAside('bill', id) })
    const input = { bill: { id: 'b1', party: { name: 'Ruby', phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-08', rows: [row('Pen', '10', '9'), blankRow()] } }
    expect(() => bs.save(input as never)).toThrow(expect.objectContaining({ code: 'RECORD_ASIDE' }))
    expect(() => bs.delete(['b1'])).toThrow(expect.objectContaining({ code: 'RECORD_ASIDE' }))
    expect(bs.save({ bill: { ...input.bill, id: 'free' } } as never)).toMatchObject({ id: 'free' }) // a different bill saves normally
  })

  it('retryAside: still too new -> stays; after the reader version rises -> applied and removed', () => {
    const { svc, applied, setVer } = setup()
    svc.ingest(raw('b1', { minReaderVer: 2 })); svc.ingest(raw('b2', { minReaderVer: 3 }))
    expect(svc.retryAside()).toEqual({ applied: 0, stillAside: 2, invalid: 0, failed: 0 })
    expect(svc.count()).toBe(2)
    setVer(2)
    expect(svc.retryAside()).toEqual({ applied: 1, stillAside: 1, invalid: 0, failed: 0 })
    expect(applied.map((a) => a.recId)).toEqual(['b1'])
    expect(applied[0]).toMatchObject({ version: 1, serverSeq: 3, editedAt: '2026-10-12T00:00:00.000Z', appVer: '9.9.9' })
    expect(svc.isAside('bill', 'b1')).toBe(false)
    expect(() => svc.assertEditable('bill', 'b1')).not.toThrow()
    setVer(3)
    expect(svc.retryAside().applied).toBe(1)
    expect(svc.count()).toBe(0)
  })

  it('retryAside: an apply that throws leaves the record set aside and is retried next time', () => {
    const { svc, applied, setVer, failNext } = setup()
    svc.ingest(raw('b1', { minReaderVer: 2 }))
    setVer(2); failNext()
    expect(svc.retryAside()).toEqual({ applied: 0, stillAside: 0, invalid: 0, failed: 1 })
    expect(svc.count()).toBe(1)
    expect(svc.retryAside().applied).toBe(1)
    expect(applied).toHaveLength(1)
  })

  it('retryAside: stored JSON that is damaged is counted, kept, and does not stop the others', () => {
    const { svc, repo, setVer } = setup()
    repo.putAside({ kind: 'bill', recId: 'bad', version: 1, minReaderVer: 2, payloadJson: '{oops', seenAt: 'x' })
    svc.ingest(raw('b1', { minReaderVer: 2 }))
    setVer(2)
    expect(svc.retryAside()).toMatchObject({ applied: 1, invalid: 1 })
    expect(repo.isAside('bill', 'bad')).toBe(true)
  })

  it('a newer set-aside copy wins over an older one; a readable version arriving later clears the aside row', () => {
    const { svc, repo } = setup()
    svc.ingest(raw('b1', { minReaderVer: 2, version: 4 }))
    svc.ingest(raw('b1', { minReaderVer: 2, version: 3 })) // out-of-order older copy
    expect(repo.getAside('bill', 'b1')?.version).toBe(4)
    expect(svc.ingest(raw('b1', { version: 5 })).outcome).toBe('apply') // the sender lowered min_reader_ver (a later version is readable)
    expect(svc.isAside('bill', 'b1')).toBe(false)
  })
})
