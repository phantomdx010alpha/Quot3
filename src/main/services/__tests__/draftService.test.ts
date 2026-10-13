import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyBill } from '../../../shared/billModel'
import { row } from '../../../shared/__fixtures__/bills'
import { buildDraftPayload } from '../../../shared/draft'
import type { Bill } from '../../../shared/types'
import { createDraftRepo } from '../../db/draftRepo'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { draftHandlers } from '../../ipc/drafts'
import { createDraftService } from '../draftService'

const open: TestDb[] = []
afterEach(() => { while (open.length) open.pop()!.cleanup() })

let n = 0
const bill = (id: string, party = 'Ruby Traders', over: Partial<Bill> = {}): Bill => ({
  ...createEmptyBill({ branchId: 'br1', rowCount: 0 }), id, party: { name: party, phone: '', address: '', transport: '' }, rows: [row('Pen', '2', '3')], ...over
})
const payload = (b: Bill): string => JSON.stringify(buildDraftPayload(b))
function mk(at = new Date('2026-10-08T10:00:00.000Z'), opts: { writable?: boolean } = {}) {
  const t = openTestDb()
  open.push(t)
  let now = at
  const mkSvc = (db = t.handle.sqlite) => createDraftService(createDraftRepo(db), { ...opts, now: () => now, newId: () => `gen-${++n}`, branchId: () => 'br1' })
  return { t, svc: mkSvc(), mkSvc, setNow: (d: Date) => { now = d } }
}
const count = (t: TestDb, table: string): number => (t.handle.sqlite.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c

describe('draftService CRUD (real SQLite)', () => {
  it('save creates ONE row per session id; saving again updates it', () => {
    const { t, svc, setNow } = mk()
    const a = svc.save({ draftId: 'sess-1', payload: payload(bill('sess-1')) })
    expect(a.draftId).toBe('sess-1')
    setNow(new Date('2026-10-08T10:05:00.000Z'))
    svc.save({ draftId: 'sess-1', payload: payload(bill('sess-1', 'Ruby Traders & Co')) })
    expect(count(t, 'drafts')).toBe(1)
    expect(svc.get('sess-1').bill.party.name).toBe('Ruby Traders & Co')
    expect(svc.get('sess-1').updatedAt).toBe('2026-10-08T10:05:00.000Z')
  })
  it('no draftId → a generated one; billId is stored for an edit of a saved bill', () => {
    const { svc } = mk()
    const r = svc.save({ billId: 'saved-1', payload: payload(bill('saved-1', 'X', { poNumber: 'Q3-0001' })) })
    expect(r.draftId).toMatch(/^gen-/)
    expect(svc.get(r.draftId).billId).toBe('saved-1')
    expect(svc.list()[0]).toMatchObject({ billId: 'saved-1', poNumber: 'Q3-0001', partyName: 'X' })
  })
  it('list is newest first and shows party, rows and time', () => {
    const { svc, setNow } = mk()
    svc.save({ draftId: 'a', payload: payload(bill('a', 'Old Co')) })
    setNow(new Date('2026-10-08T11:00:00.000Z'))
    svc.save({ draftId: 'b', payload: payload(bill('b', 'New Co')) })
    expect(svc.list().map((d) => d.partyName)).toEqual(['New Co', 'Old Co'])
    expect(svc.list()[0]).toMatchObject({ id: 'b', filledRows: 1, updatedAt: '2026-10-08T11:00:00.000Z' })
  })
  it('get of an unknown id → NOT_FOUND; delete is idempotent', () => {
    const { svc } = mk()
    expect(() => svc.get('nope')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
    svc.save({ draftId: 'a', payload: payload(bill('a')) })
    expect(svc.delete('a')).toEqual({ deleted: true })
    expect(svc.delete('a')).toEqual({ deleted: false })
    expect(svc.list()).toEqual([])
  })
  it('an unreadable payload is refused (VALIDATION) and nothing is written', () => {
    const { t, svc } = mk()
    expect(() => svc.save({ draftId: 'a', payload: '{not json' })).toThrow(expect.objectContaining({ code: 'VALIDATION' }))
    expect(() => svc.save({ draftId: 'a', payload: '{"v":1,"bill":{}}' })).toThrow(expect.objectContaining({ code: 'VALIDATION' }))
    expect(count(t, 'drafts')).toBe(0)
  })
  it('a damaged stored row is skipped by list and reported by get (DB_ERROR)', () => {
    const { t, svc } = mk()
    svc.save({ draftId: 'good', payload: payload(bill('good')) })
    t.handle.sqlite.prepare("INSERT INTO drafts (id, bill_id, payload_json, updated_at) VALUES ('bad', NULL, '{oops', '2026-10-08T10:00:00.000Z')").run()
    expect(svc.list().map((d) => d.id)).toEqual(['good'])
    expect(() => svc.get('bad')).toThrow(expect.objectContaining({ code: 'DB_ERROR' }))
  })
  it('a read-only database refuses writes but still lists', () => {
    const { t, svc } = mk(undefined, { writable: false })
    expect(() => svc.save({ draftId: 'a', payload: payload(bill('a')) })).toThrow(expect.objectContaining({ code: 'DB_ERROR' }))
    expect(() => svc.delete('a')).toThrow(expect.objectContaining({ code: 'DB_ERROR' }))
    expect(() => svc.cleanupStale()).toThrow(expect.objectContaining({ code: 'DB_ERROR' }))
    expect(svc.list()).toEqual([])
    expect(count(t, 'drafts')).toBe(0)
  })
})

describe('crash recovery (a fresh app state finds the draft)', () => {
  it('a draft written before the "crash" is listed and fully readable after reopening the database file', () => {
    const { t, svc } = mk()
    const b = bill('sess-9', 'Lakshmi Cloth', {
      extraCols: [{ key: 'c1', header: 'ruby', kind: 'units' }],
      rows: [{ ...row('', '1', '100'), nameRuns: [{ t: 'Red thing', r: 1, b: 1 }], extras: { c1: { text: '(125-5)', marked: true } } }]
    })
    svc.save({ draftId: 'sess-9', payload: payload(b) })
    // "kill the process": no orderly shutdown, just a new connection to the same file with new service objects
    t.reopen()
    const fresh = createDraftService(createDraftRepo(t.handle.sqlite))
    expect(fresh.list()).toHaveLength(1)
    expect(fresh.list()[0]).toMatchObject({ id: 'sess-9', partyName: 'Lakshmi Cloth', poNumber: '' })
    const got = fresh.get('sess-9').bill
    expect(got.rows[0]!.nameRuns).toEqual([{ t: 'Red thing', r: 1, b: 1 }])
    expect(got.rows[0]!.extras).toEqual({ c1: { text: '(125-5)', marked: true } })
    expect(got.extraCols[0]!.header).toBe('ruby')
  })
})

describe('stale cleanup (> 14 days) with an audit row', () => {
  it('removes only drafts older than 14 days, writes ONE audit row listing them', () => {
    const { t, svc, setNow } = mk(new Date('2026-09-20T10:00:00.000Z'))
    svc.save({ draftId: 'old', payload: payload(bill('old')) }) // 20 Sep
    setNow(new Date('2026-09-26T10:00:00.000Z'))
    svc.save({ draftId: 'edge', payload: payload(bill('edge')) }) // exactly 14 days before 10 Oct
    setNow(new Date('2026-10-05T10:00:00.000Z'))
    svc.save({ draftId: 'fresh', payload: payload(bill('fresh')) })
    setNow(new Date('2026-10-10T10:00:00.000Z'))
    expect(svc.cleanupStale()).toBe(1)
    expect(svc.list().map((d) => d.id).sort()).toEqual(['edge', 'fresh'])
    const audit = t.handle.sqlite.prepare("SELECT entity, action, branch_id AS b, detail_json AS d, at FROM audit_log").all() as Array<{ entity: string; action: string; b: string; d: string; at: string }>
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ entity: 'draft', action: 'cleanup', b: 'br1', at: '2026-10-10T10:00:00.000Z' })
    expect(JSON.parse(audit[0]!.d)).toEqual({ removed: 1, olderThanDays: 14, ids: ['old'] })
  })
  it('nothing stale → nothing removed and NO audit row; a second run is a no-op', () => {
    const { t, svc } = mk()
    svc.save({ draftId: 'a', payload: payload(bill('a')) })
    expect(svc.cleanupStale()).toBe(0)
    expect(count(t, 'audit_log')).toBe(0)
  })
  it('also removes an unreadable stale row; removing and auditing are one transaction', () => {
    const { t, svc, setNow } = mk()
    t.handle.sqlite.prepare("INSERT INTO drafts (id, bill_id, payload_json, updated_at) VALUES ('bad', NULL, '{oops', '2026-01-01T00:00:00.000Z')").run()
    setNow(new Date('2026-10-08T10:00:00.000Z'))
    expect(svc.cleanupStale()).toBe(1)
    expect(count(t, 'drafts')).toBe(0)
    expect(count(t, 'audit_log')).toBe(1)
  })
})

describe('drafts:* IPC validation', () => {
  it('round trip and rejections leave the table untouched', async () => {
    const { t, svc } = mk()
    const h = draftHandlers(svc)
    const ok = (await h['drafts:save']!({ draftId: 'a', payload: payload(bill('a')) })) as { ok: boolean }
    expect(ok.ok).toBe(true)
    expect(((await h['drafts:list']!({})) as { data: unknown[] }).data).toHaveLength(1)
    expect(((await h['drafts:get']!({ id: 'a' })) as { ok: boolean }).ok).toBe(true)
    for (const bad of [{ payload: '' }, { draftId: '', payload: '{}' }, { draftId: 'a', payload: '{}', extra: 1 }, { draftId: 'a', payload: 5 }, {}]) {
      expect(((await h['drafts:save']!(bad)) as { ok: boolean }).ok).toBe(false)
    }
    expect(((await h['drafts:list']!({ x: 1 })) as { ok: boolean }).ok).toBe(false)
    expect(((await h['drafts:get']!({ id: 'zzz' })) as { ok: boolean; error: { code: string } }).error.code).toBe('NOT_FOUND')
    expect(((await h['drafts:delete']!({ id: 'a' })) as { data: { deleted: boolean } }).data.deleted).toBe(true)
    expect(count(t, 'drafts')).toBe(0)
  })
})
