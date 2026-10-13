import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createOutboxRepo } from '../../db/outboxRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createTrashRepo } from '../../db/trashRepo'
import { getLocalBranch } from '../../db/seed'
import { syncHandlers } from '../../ipc/sync'
import { createBillService, type SaveBillInput } from '../../services/billService'
import { createTrashService } from '../../services/trashService'
import { createOutbox } from '../outbox'
import { OUTBOX_MAX_ATTEMPTS } from '../../../shared/sync/outbox'
import { blankRow, row } from '../../../shared/__fixtures__/bills'

const open: TestDb[] = []
afterEach(() => open.splice(0).forEach((t) => t.cleanup()))
let n = 0

function mk(over: { capturing?: boolean } = {}) {
  const t = openTestDb(); open.push(t)
  const sqlite = t.handle.sqlite
  let clock = Date.UTC(2026, 9, 10, 10, 0, 0)
  const now = (): Date => new Date(clock)
  const advance = (ms: number): void => { clock += ms }
  const state = { on: over.capturing ?? true }
  const outbox = createOutbox({ repo: createOutboxRepo(sqlite), capturing: () => state.on }, { now })
  const capture = (i: { billId: string; revision: number; op?: 'upsert' | 'delete' }): void => outbox.capture({ billId: i.billId, revision: i.revision, op: i.op ?? 'upsert' })
  const bills = createBillService({ sqlite, bills: createBillRepo(sqlite), parties: createPartyRepo(sqlite) }, { now, newId: () => `ob-${++n}`, outbox: capture })
  const trash = createTrashService({ repo: createTrashRepo(sqlite), branchId: () => getLocalBranch(sqlite).id }, { now, outbox: capture })
  const rows = (): { bill_id: string; op: string; revision: number; state: string; attempts: number }[] =>
    sqlite.prepare('SELECT bill_id, op, revision, state, attempts FROM sync_outbox ORDER BY id').all() as never
  const syncOf = (id: string): string => (sqlite.prepare('SELECT sync_state AS s FROM bills WHERE id = ?').get(id) as { s: string }).s
  return { t, sqlite, outbox, bills, trash, state, rows, syncOf, advance }
}

const input = (id: string, qty = '10'): SaveBillInput => ({
  bill: {
    id, party: { name: 'Ruby Traders', phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null,
    billDate: '2026-10-10', rows: [row('Pen', qty, '9'), blankRow()]
  }
})

describe('outbox capture (Phase 54)', () => {
  it('a save writes ONE outbox row in the same transaction and marks the bill pending', () => {
    const c = mk()
    const r = c.bills.save(input('b1'))
    expect(c.rows()).toEqual([{ bill_id: 'b1', op: 'upsert', revision: r.revision, state: 'pending', attempts: 0 }])
    expect(c.syncOf('b1')).toBe('pending')
  })

  it('nothing is captured while no license is activated: bills stay local_only', () => {
    const c = mk({ capturing: false })
    c.bills.save(input('b1'))
    c.bills.delete(['b1'])
    expect(c.rows()).toEqual([])
    expect(c.syncOf('b1')).toBe('local_only')
    expect(c.outbox.status().capturing).toBe(false)
  })

  it('a failed save (validation) leaves no outbox row and no bill', () => {
    const c = mk()
    const bad = input('b1'); bad.bill.party = { name: '   ', phone: '', address: '', transport: '' }
    expect(() => c.bills.save(bad)).toThrow()
    expect(c.rows()).toEqual([])
    expect(c.sqlite.prepare('SELECT count(*) AS c FROM bills').get()).toEqual({ c: 0 })
  })

  it('crash safety: if the transaction rolls back AFTER the hook ran, the row is gone too', () => {
    const c = mk()
    const repo = createOutboxRepo(c.sqlite)
    expect(() => repo.transaction(() => {
      repo.enqueue({ billId: 'x', op: 'upsert', revision: 1, at: '2026-10-10T10:00:00.000Z', keepSyncedBefore: '2026-10-01T00:00:00.000Z' })
      throw new Error('boom')
    })).toThrow('boom')
    expect(c.rows()).toEqual([])
    // a service-level case: the hook itself throws, so the whole save (bill included) rolls back
    const svc = createBillService({ sqlite: c.sqlite, bills: createBillRepo(c.sqlite), parties: createPartyRepo(c.sqlite) }, { newId: () => 'z1', outbox: () => { throw new Error('outbox down') } })
    expect(() => svc.save(input('z1'))).toThrow('outbox down')
    expect(c.sqlite.prepare('SELECT count(*) AS c FROM bills').get()).toEqual({ c: 0 })
    expect(c.rows()).toEqual([])
  })

  it('a newer change to the same bill replaces the unsent older row (one row per bill in flight)', () => {
    const c = mk()
    c.bills.save(input('b1'))
    c.bills.save({ ...input('b1', '12'), expectedRevision: 1 })
    expect(c.rows().map((r) => [r.op, r.revision])).toEqual([['upsert', 2]])
  })

  it('delete is a delete op; restore is an upsert at a higher revision', () => {
    const c = mk()
    c.bills.save(input('b1'))
    c.bills.delete(['b1'])
    expect(c.rows().map((r) => [r.op, r.revision])).toEqual([['delete', 2]])
    c.trash.restore(['b1'])
    expect(c.rows().map((r) => [r.op, r.revision])).toEqual([['upsert', 3]])
    expect(c.syncOf('b1')).toBe('pending')
  })

  it('only unsent rows are replaced: a sent row stays as history until pruned', () => {
    const c = mk()
    c.bills.save(input('b1'))
    const [first] = c.outbox.repo.pending(10)
    c.outbox.repo.markSynced(first!.id)
    expect(c.syncOf('b1')).toBe('synced')
    c.bills.save({ ...input('b1', '13'), expectedRevision: 1 })
    expect(c.rows().map((r) => [r.revision, r.state])).toEqual([[1, 'synced'], [2, 'pending']])
    expect(c.syncOf('b1')).toBe('pending')
    c.advance(8 * 86_400_000)
    c.bills.save({ ...input('b1', '14'), expectedRevision: 2 })
    expect(c.rows().map((r) => [r.revision, r.state])).toEqual([[3, 'pending']])
  })
})

describe('outbox repo state machine', () => {
  it('markSynced keeps the bill pending while another unsent row exists, and never overrides a conflict', () => {
    const c = mk()
    c.bills.save(input('b1'))
    const repo = c.outbox.repo
    const id1 = repo.pending(10)[0]!.id
    const id2 = repo.enqueue({ billId: 'b1', op: 'upsert', revision: 2, at: '2026-10-10T11:00:00.000Z', keepSyncedBefore: '2000-01-01T00:00:00.000Z' })
    // enqueue replaced id1, so marking the stale id1 is a no-op
    repo.markSynced(id1)
    expect(c.syncOf('b1')).toBe('pending')
    c.sqlite.prepare("UPDATE bills SET sync_state = 'conflict' WHERE id = 'b1'").run()
    repo.markSynced(id2)
    expect(c.syncOf('b1')).toBe('conflict')
  })

  it('attempts count up; at the limit the row becomes failed with the last error; retry puts it back', () => {
    const c = mk()
    c.bills.save(input('b1'))
    const repo = c.outbox.repo
    const id = repo.pending(1)[0]!.id
    for (let i = 1; i < OUTBOX_MAX_ATTEMPTS; i++) expect(repo.markAttempt(id, 'offline')).toBe('pending')
    expect(repo.markAttempt(id, 'x'.repeat(500))).toBe('failed')
    expect(repo.counts()).toEqual({ pending: 0, failed: 1, synced: 0 })
    const failed = repo.list('failed')
    expect(failed[0]).toMatchObject({ id, attempts: OUTBOX_MAX_ATTEMPTS, state: 'failed', poNumber: 'Q3-0001' })
    expect(failed[0]!.lastError!.length).toBe(300)
    expect(repo.retryFailed([id + 99])).toBe(0)
    expect(repo.retryFailed()).toBe(1)
    expect(repo.list('pending')[0]).toMatchObject({ id, attempts: 0, state: 'pending' })
    expect(c.syncOf('b1')).toBe('pending')
  })

  it('pending() is oldest first and limited; unknown ids are ignored', () => {
    const c = mk()
    for (const id of ['a', 'b', 'c']) c.bills.save(input(id))
    expect(c.outbox.repo.pending(2).map((r) => r.billId)).toEqual(['a', 'b'])
    c.outbox.repo.markSynced(9999)
    expect(c.outbox.repo.markAttempt(9999, 'x')).toBe('failed')
  })

  it('status() reports counts, the oldest pending time and the lists', () => {
    const c = mk()
    expect(c.outbox.status()).toMatchObject({ capturing: true, counts: { pending: 0, failed: 0, synced: 0 }, oldestPendingAt: null, pending: [], failed: [] })
    c.bills.save(input('a')); c.advance(60_000); c.bills.save(input('b'))
    const s = c.outbox.status()
    expect(s.counts.pending).toBe(2)
    expect(s.oldestPendingAt).toBe('2026-10-10T10:00:00.000Z')
    expect(s.pending.map((p) => p.poNumber)).toEqual(['Q3-0001', 'Q3-0002'])
  })

  it('IPC: strict (no extra fields) and returns the status envelope', async () => {
    const c = mk()
    c.bills.save(input('a'))
    const h = syncHandlers(c.outbox)['sync:outbox']!
    expect(await h({})).toMatchObject({ ok: true, data: { counts: { pending: 1 } } })
    expect(await h({ x: 1 })).toMatchObject({ ok: false })
  })
})
