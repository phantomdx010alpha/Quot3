import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createTrashRepo } from '../../db/trashRepo'
import { createBillService, type SaveBillInput } from '../billService'
import { createTrashService, type SavedInfoLike } from '../trashService'
import { trashHandlers } from '../../ipc/trash'
import { getLocalBranch } from '../../db/seed'
import { blankRow, row } from '../../../shared/__fixtures__/bills'

const open: TestDb[] = []
afterEach(() => open.splice(0).forEach((t) => t.cleanup()))

const DAY = 86_400_000
let n = 0

function mk(opts: { writable?: boolean } = {}) {
  const t = openTestDb()
  open.push(t)
  const sqlite = t.handle.sqlite
  let clock = Date.UTC(2026, 9, 8, 10, 0, 0)
  const now = (): Date => new Date(clock)
  const advance = (ms: number): void => { clock += ms }
  const bills = createBillService(
    { sqlite, bills: createBillRepo(sqlite), parties: createPartyRepo(sqlite) },
    { ...opts, newId: () => `gen-${++n}`, now }
  )
  const outbox: SavedInfoLike[] = []
  const trash = createTrashService(
    { repo: createTrashRepo(sqlite), branchId: () => getLocalBranch(sqlite).id },
    { ...opts, now, outbox: (i) => outbox.push(i) }
  )
  return { t, sqlite, bills, trash, now, advance, outbox }
}

const input = (id: string, party = 'Ruby Traders'): SaveBillInput => ({
  bill: {
    id, party: { name: party, phone: '98450 11001', address: '1 Main Rd', transport: 'VRL' }, formatId: 'non_gst', extraCols: [{ key: 'c1', header: 'ruby', kind: 'units' }],
    paperOverride: null, billDate: '2026-10-08',
    rows: [{ ...row('Pen', '10', '9'), extras: { c1: { text: '(125-5)', marked: true } } }, row('Book', '2', '45.50'), blankRow(), blankRow(), blankRow()]
  }
})
const count = (db: TestDb['handle']['sqlite'], table: string, where = '1=1'): number => (db.prepare(`SELECT count(*) AS c FROM ${table} WHERE ${where}`).get() as { c: number }).c

describe('trashService - restore', () => {
  it('delete -> restore returns a deep-equal bill with the same PO number (revision is the only change, +2)', () => {
    const { bills, trash } = mk()
    bills.save(input('b1'))
    const before = bills.getForEdit('b1')
    expect(bills.delete(['b1']).deleted).toEqual(['b1'])
    expect(() => bills.getForEdit('b1')).toThrow(/not found/i)
    expect(trash.list().map((t) => t.id)).toEqual(['b1'])
    expect(trash.restore(['b1'])).toEqual({ restored: ['b1'], missing: [] })
    const after = bills.getForEdit('b1')
    expect(after.poNumber).toBe('Q3-0001')
    expect(after.deletedAt).toBeNull()
    const strip = ({ revision: _r, updatedAt: _u, ...rest }: typeof before): unknown => rest
    expect(strip(after)).toEqual(strip(before))
    expect(after.revision).toBe(before.revision + 2) // delete bumped once, restore bumped again: the restore supersedes the tombstone
    expect(trash.list()).toEqual([])
  })

  it('restored bills show up in History again and the outbox hook hears the new revision', () => {
    const { bills, trash, sqlite, outbox } = mk()
    bills.save(input('b1'))
    bills.delete(['b1'])
    trash.restore(['b1'])
    expect(count(sqlite, 'bills', 'deleted_at IS NULL')).toBe(1)
    expect(outbox).toEqual([{ billId: 'b1', revision: 3, created: false, branchId: getLocalBranch(sqlite).id }])
  })

  it('live and unknown ids are reported as missing, nothing else changes; duplicates count once', () => {
    const { bills, trash, sqlite } = mk()
    bills.save(input('live'))
    bills.save(input('gone'))
    bills.delete(['gone'])
    const r = trash.restore(['live', 'nope', 'gone', 'gone'])
    expect(r).toEqual({ restored: ['gone'], missing: ['live', 'nope'] })
    expect((sqlite.prepare("SELECT revision FROM bills WHERE id = 'live'").get() as { revision: number }).revision).toBe(1)
  })

  it('a restored bill can be edited and saved again (PO kept, no CONFLICT)', () => {
    const { bills, trash } = mk()
    bills.save(input('b1'))
    bills.delete(['b1'])
    trash.restore(['b1'])
    const head = bills.getForEdit('b1')
    const r = bills.save({ ...input('b1'), expectedRevision: head.revision })
    expect(r.poNumber).toBe('Q3-0001')
    expect(r.revision).toBe(head.revision + 1)
  })
})

describe('trashService - purge, empty, retention', () => {
  it('purge hard-deletes only trashed bills (rows + revisions go too), writes ONE audit row, never touches live bills', () => {
    const { bills, trash, sqlite } = mk()
    bills.save(input('a'))
    bills.save(input('b'))
    bills.save(input('live'))
    bills.delete(['a', 'b'])
    const r = trash.purge(['a', 'b', 'live', 'nope'])
    expect(r).toEqual({ purged: ['a', 'b'], missing: ['live', 'nope'] })
    expect(count(sqlite, 'bills')).toBe(1)
    expect(count(sqlite, 'bill_rows', "bill_id IN ('a','b')")).toBe(0)
    expect(count(sqlite, 'bill_revisions', "bill_id IN ('a','b')")).toBe(0)
    expect(count(sqlite, 'bill_rows', "bill_id = 'live'")).toBe(2)
    const audit = sqlite.prepare("SELECT entity, action, detail_json AS d FROM audit_log WHERE action = 'purge'").all() as Array<{ entity: string; action: string; d: string }>
    expect(audit).toHaveLength(1)
    expect(JSON.parse(audit[0]!.d)).toMatchObject({ ids: ['a', 'b'], count: 2 })
  })

  it('purging nothing writes no audit row', () => {
    const { trash, sqlite } = mk()
    expect(trash.purge(['x'])).toEqual({ purged: [], missing: ['x'] })
    expect(count(sqlite, 'audit_log')).toBe(0)
  })

  it('drafts of a purged bill are removed with it (they have no foreign key)', () => {
    const { bills, trash, sqlite } = mk()
    bills.save(input('a'))
    sqlite.prepare("INSERT INTO drafts (id, bill_id, payload_json, updated_at) VALUES ('d1', 'a', '{}', '2026-10-08T10:00:00.000Z'), ('d2', NULL, '{}', '2026-10-08T10:00:00.000Z')").run()
    bills.delete(['a'])
    trash.purge(['a'])
    expect(count(sqlite, 'drafts', "id = 'd1'")).toBe(0)
    expect(count(sqlite, 'drafts', "id = 'd2'")).toBe(1)
  })

  it('PO numbers are never reused after a purge', () => {
    const { bills, trash } = mk()
    bills.save(input('a'))
    bills.save(input('b'))
    bills.delete(['a', 'b'])
    trash.purge(['a', 'b'])
    expect(bills.save(input('c')).poNumber).toBe('Q3-0003')
    bills.delete(['c'])
    trash.emptyTrash()
    expect(bills.save(input('d')).poNumber).toBe('Q3-0004')
  })

  it('emptyTrash purges everything in the trash with ONE audit row and leaves live bills alone', () => {
    const { bills, trash, sqlite } = mk()
    for (const id of ['a', 'b', 'c', 'live']) bills.save(input(id))
    bills.delete(['a', 'b', 'c'])
    expect(trash.emptyTrash()).toEqual({ purged: 3 })
    expect(count(sqlite, 'bills')).toBe(1)
    const audit = sqlite.prepare("SELECT detail_json AS d FROM audit_log WHERE action = 'empty_trash'").all() as Array<{ d: string }>
    expect(audit).toHaveLength(1)
    expect(JSON.parse(audit[0]!.d).count).toBe(3)
    expect(trash.emptyTrash()).toEqual({ purged: 0 })
    expect(count(sqlite, 'audit_log', "action = 'empty_trash'")).toBe(1)
  })

  it('autoPurge honours the retention: exactly 30 days old stays, older goes, with ONE audit row listing ids and the cutoff', () => {
    const { bills, trash, sqlite, advance } = mk()
    bills.save(input('old'))
    bills.save(input('edge'))
    bills.save(input('fresh'))
    bills.delete(['old'])            // deleted at T0
    advance(1 * DAY)
    bills.delete(['edge'])           // T0 + 1 day
    advance(29 * DAY)                // now = T0 + 30 days: 'old' is exactly 30 days old, 'edge' 29
    advance(1000)                    // 'old' is now 30 days + 1 s
    bills.delete(['fresh'])
    expect(trash.autoPurge()).toBe(1)
    expect(trash.list().map((t) => t.id).sort()).toEqual(['edge', 'fresh'])
    const audit = sqlite.prepare("SELECT detail_json AS d FROM audit_log WHERE action = 'auto_purge'").all() as Array<{ d: string }>
    expect(audit).toHaveLength(1)
    expect(JSON.parse(audit[0]!.d)).toMatchObject({ ids: ['old'], count: 1, retentionDays: 30 })
    expect(trash.autoPurge()).toBe(0)
    expect(count(sqlite, 'audit_log', "action = 'auto_purge'")).toBe(1)
  })

  it('autoPurge uses the setting when given (shorter and longer) and a day argument overrides it', () => {
    const t = openTestDb(); open.push(t)
    const sqlite = t.handle.sqlite
    let clock = Date.UTC(2026, 9, 8, 10)
    const now = (): Date => new Date(clock)
    const bills = createBillService({ sqlite, bills: createBillRepo(sqlite), parties: createPartyRepo(sqlite) }, { newId: () => `x-${++n}`, now })
    let retention: unknown = 7
    const trash = createTrashService({ repo: createTrashRepo(sqlite), branchId: () => null }, { now, retention: () => retention })
    bills.save(input('a'))
    bills.delete(['a'])
    clock += 10 * DAY
    retention = 60
    expect(trash.retentionDays()).toBe(60)
    expect(trash.autoPurge()).toBe(0)
    retention = 7
    expect(trash.list()[0]!.purgeAt).toBe(new Date(Date.UTC(2026, 9, 8, 10) + 7 * DAY).toISOString())
    expect(trash.autoPurge()).toBe(1)
    bills.save(input('b'))
    bills.delete(['b'])
    clock += 3 * DAY
    expect(trash.autoPurge(2)).toBe(1)
    retention = 'garbage'
    expect(trash.retentionDays()).toBe(30)
  })

  it('list: most recently deleted first, with party, total, deleted-at and purge date', () => {
    const { bills, trash, advance } = mk()
    bills.save(input('a', 'Alpha'))
    bills.save(input('b', 'Beta'))
    bills.delete(['a'])
    advance(60_000)
    bills.delete(['b'])
    const l = trash.list()
    expect(l.map((t) => t.partyName)).toEqual(['Beta', 'Alpha'])
    expect(l[0]).toMatchObject({ id: 'b', poNumber: 'Q3-0002', grandTotal: '181.00', revision: 2 })
    expect(Date.parse(l[0]!.purgeAt) - Date.parse(l[0]!.deletedAt)).toBe(30 * DAY)
  })

  it('a read-only database refuses every write (list still works)', () => {
    const { trash } = mk({ writable: false })
    expect(trash.list()).toEqual([])
    expect(() => trash.restore(['x'])).toThrow(/read-only/i)
    expect(() => trash.purge(['x'])).toThrow(/read-only/i)
    expect(() => trash.emptyTrash()).toThrow(/read-only/i)
    expect(() => trash.autoPurge()).toThrow(/read-only/i)
  })
})

describe('trash:* IPC validation', () => {
  it('strict inputs; the destructive ones reject anything malformed with the data untouched', async () => {
    const { bills, trash, sqlite } = mk()
    bills.save(input('a'))
    bills.delete(['a'])
    const h = trashHandlers(trash)
    const bad = async (ch: string, payload: unknown): Promise<void> => {
      const r = (await h[ch]!(payload)) as { ok: boolean; error?: { code: string } }
      expect(r.ok, ch).toBe(false)
      expect(r.error?.code).toBe('VALIDATION')
    }
    await bad('trash:list', { extra: 1 })
    await bad('trash:restore', { ids: [] })
    await bad('trash:restore', { ids: [''] })
    await bad('trash:restore', { ids: ['a'], extra: true })
    await bad('trash:restore', { ids: Array.from({ length: 501 }, (_, i) => `i${i}`) })
    await bad('trash:purge', { ids: 'a' })
    await bad('trash:purge', {})
    await bad('trash:emptyTrash', {})
    await bad('trash:emptyTrash', { confirm: 'yes' })
    await bad('trash:emptyTrash', { confirm: 'empty' })
    await bad('trash:emptyTrash', { confirm: 'EMPTY', x: 1 })
    expect(count(sqlite, 'bills')).toBe(1)
    expect(count(sqlite, 'audit_log')).toBe(0)
  })

  it('round trip through the handlers', async () => {
    const { bills, trash } = mk()
    bills.save(input('a'))
    bills.save(input('b'))
    bills.delete(['a', 'b'])
    const h = trashHandlers(trash)
    const list = (await h['trash:list']!({})) as { ok: true; data: Array<{ id: string }> }
    expect(list.data).toHaveLength(2)
    expect(await h['trash:restore']!({ ids: ['a'] })).toEqual({ ok: true, data: { restored: ['a'], missing: [] } })
    expect(await h['trash:purge']!({ ids: ['b'] })).toEqual({ ok: true, data: { purged: ['b'], missing: [] } })
    expect(await h['trash:emptyTrash']!({ confirm: 'EMPTY' })).toEqual({ ok: true, data: { purged: 0 } })
  })
})
