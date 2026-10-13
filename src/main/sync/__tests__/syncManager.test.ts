import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createOutboxRepo } from '../../db/outboxRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createSyncStateRepo } from '../../db/syncStateRepo'
import { getLocalBranch } from '../../db/seed'
import { syncHandlers } from '../../ipc/sync'
import { createBillService, type SaveBillInput } from '../../services/billService'
import { createOutbox } from '../outbox'
import { createPushWorker } from '../pushWorker'
import { createSyncManager, type ManagedWorker } from '../syncManager'
import { InMemoryTransport } from '../transport'
import { OUTBOX_MAX_ATTEMPTS } from '../../../shared/sync/outbox'
import { SYNC_ENABLED_KEY } from '../../../shared/sync/manager'
import type { PullStatus } from '../../../shared/sync/pull'
import type { PushStatus } from '../../../shared/sync/push'
import { blankRow, row } from '../../../shared/__fixtures__/bills'

const LICENSE = 'Q3-ABCD-EFGH-JKLM'
const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const U = (name: string): string => `00000000-0000-4000-8000-${createHash('sha1').update(name).digest('hex').slice(0, 12)}`
const dbs: TestDb[] = []
afterEach(() => dbs.splice(0).forEach((t) => t.cleanup()))
let n = 0

const pushSt = (o: Partial<PushStatus> = {}): PushStatus => ({ running: false, block: 'idle', consecutiveFailures: 0, nextDelayMs: 15_000, lastRunAt: null, lastSuccessAt: null, lastError: null, sentTotal: 0, ...o })
const pullSt = (o: Partial<PullStatus> = {}): PullStatus => ({ running: false, block: 'idle', consecutiveFailures: 0, nextDelayMs: 30_000, lastRunAt: null, lastSuccessAt: null, lastError: null, appliedTotal: 0, cursor: 0, unacked: 0, skipped: [], held: [], ...o })

/** A worker that only records what the manager asks of it. */
function fakeWorker<S>(status: () => S): ManagedWorker<S> & { calls: string[] } {
  const calls: string[] = []
  return { calls, start: () => { calls.push('start') }, stop: () => { calls.push('stop') }, notifyOnline: () => { calls.push('online') }, runOnce: async () => { calls.push('run') }, status }
}

function world(opts: { activated?: boolean; writable?: boolean } = {}) {
  const t = openTestDb(); dbs.push(t)
  const sqlite = t.handle.sqlite
  const sync = createSyncStateRepo(sqlite)
  const outbox = createOutbox({ repo: createOutboxRepo(sqlite), capturing: () => true })
  const st = { activated: opts.activated ?? true, push: pushSt(), pull: pullSt(), conflicts: 0 }
  const push = fakeWorker(() => st.push), pull = fakeWorker(() => st.pull)
  const sent: unknown[] = []
  const make = (): ReturnType<typeof createSyncManager> => createSyncManager(
    { license: { isActivated: () => st.activated }, sync, push, pull, outbox, remote: { conflicts: () => Array.from({ length: st.conflicts }, (_, i) => ({ billId: `b${i}`, poNumber: `P${i}`, at: '', lost: 'edit' as const, loserRevision: 1, loserUpdatedAt: '', winnerBranch: 'x', winnerRevision: 2, winnerUpdatedAt: '', winnerDeleted: false })) }, emit: (c, p) => { sent.push([c, p]) }, log },
    { writable: opts.writable ?? true, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length }, clearTimer: () => undefined }
  )
  const timers: { fn: () => void; ms: number }[] = []
  return { sqlite, sync, outbox, st, push, pull, sent, make, timers }
}

describe('sync manager (Phase 59)', () => {
  it('start() runs both workers while the switch is on (also after a restart) and does nothing while it is off', () => {
    const w = world()
    w.make().start()
    expect(w.push.calls).toEqual(['start']); expect(w.pull.calls).toEqual(['start'])
    w.sync.set(SYNC_ENABLED_KEY, '0') // the owner switched it off in an earlier session
    const w2 = world(); w2.sync.set(SYNC_ENABLED_KEY, '0')
    const m = w2.make()
    m.start()
    expect(w2.push.calls).toEqual([]); expect(w2.pull.calls).toEqual([])
    expect(m.enabled()).toBe(false)
  })

  it('Phase 140: once the cutover paused v1 (cutover.v1Inert) no worker starts, the screen reads "off", Sync now is refused; suspend() stops running workers', async () => {
    const w = world()
    const m = w.make()
    m.start()
    expect(w.push.calls).toEqual(['start'])
    m.suspend()
    expect(w.push.calls).toEqual(['start', 'stop']); expect(w.pull.calls).toEqual(['start', 'stop'])
    w.sync.set('cutover.v1Inert', '1')
    expect(m.inert()).toBe(true)
    expect(m.overview().mode).toBe('off')
    m.start()
    expect(w.push.calls).toEqual(['start', 'stop']) // not started again
    await expect(m.syncNow()).rejects.toThrow(/Activate a license/)
    expect(() => m.setEnabled(true)).toThrow(/Activate a license/)
    // the old settings stay readable: the v1 license itself still says activated
    expect(w.st.activated).toBe(true)
  })

  it('state transitions: off -> on -> paused -> on, each persisted, workers stopped / started / nudged', () => {
    const w = world({ activated: false })
    const m = w.make()
    expect(m.overview().mode).toBe('off')
    expect(() => m.setEnabled(false)).toThrow(/Activate a license/)
    w.st.activated = true
    m.start()
    expect(m.overview()).toMatchObject({ activated: true, enabled: true, mode: 'ok' })
    const off = m.setEnabled(false)
    expect(off).toMatchObject({ enabled: false, mode: 'paused' })
    expect(w.sync.get(SYNC_ENABLED_KEY)).toBe('0')
    expect(w.push.calls).toEqual(['start', 'stop']); expect(w.pull.calls).toEqual(['start', 'stop'])
    const on = m.setEnabled(true)
    expect(on.enabled).toBe(true)
    expect(w.sync.get(SYNC_ENABLED_KEY)).toBe('1')
    expect(w.push.calls).toEqual(['start', 'stop', 'start', 'online']); expect(w.pull.calls).toEqual(['start', 'stop', 'start', 'online'])
    expect(w.sent.map((x) => (x as [string, { mode: string }])[0])).toEqual(['sync:status', 'sync:status']) // every switch tells the window
  })

  it('the key is a sync.* key, so Deactivate (which removes every sync.* key) turns the next activation back on', () => {
    expect(SYNC_ENABLED_KEY.startsWith('sync.')).toBe(true)
    const w = world(); w.sync.set(SYNC_ENABLED_KEY, '0')
    w.sync.remove(w.sync.keys('sync.'))
    expect(w.make().enabled()).toBe(true)
  })

  it('overview reflects the queue: waiting, failed (needs attention), offline, conflicts', () => {
    const w = world(); const m = w.make()
    w.outbox.repo.enqueue({ billId: 'x1', revision: 1, op: 'upsert', at: '2026-10-10T10:00:00.000Z', keepSyncedBefore: '2000-01-01T00:00:00.000Z' })
    expect(m.overview()).toMatchObject({ mode: 'working', pending: 1, oldestPendingAt: '2026-10-10T10:00:00.000Z' })
    w.st.push = pushSt({ block: 'offline', consecutiveFailures: 2, lastError: 'No connection' })
    expect(m.overview().mode).toBe('offline')
    w.st.push = pushSt({ block: 'license' })
    expect(m.overview()).toMatchObject({ mode: 'attention' })
    w.st.push = pushSt()
    w.st.conflicts = 2
    expect(m.overview()).toMatchObject({ mode: 'attention', conflicts: 2 })
    w.st.conflicts = 0
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i++) w.outbox.repo.markAttempt(w.outbox.repo.pending(1)[0]!.id, 'boom')
    expect(m.overview()).toMatchObject({ mode: 'attention', failed: 1, pending: 0 })
  })

  it('retry puts failed rows back (all, or chosen ids), nudges the push worker and tells the window', () => {
    const w = world(); const m = w.make(); m.start()
    for (const id of ['r1', 'r2']) {
      w.outbox.repo.enqueue({ billId: id, revision: 1, op: 'upsert', at: '2026-10-10T10:00:00.000Z', keepSyncedBefore: '2000-01-01T00:00:00.000Z' })
      for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i++) w.outbox.repo.markAttempt(w.outbox.repo.pending(1)[0]!.id, 'boom')
    }
    expect(m.overview().failed).toBe(2)
    const one = w.outbox.repo.list('failed', 5)[0]!.id
    expect(m.retry([one])).toMatchObject({ retried: 1, overview: { failed: 1, pending: 1 } })
    expect(w.push.calls).toContain('online')
    expect(m.retry()).toMatchObject({ retried: 1, overview: { failed: 0, pending: 2 } })
    expect(m.retry().retried).toBe(0)
  })

  it('Sync now runs one push and one pull; it is refused while off, paused or read-only', async () => {
    const w = world(); const m = w.make(); m.start()
    await m.syncNow()
    expect(w.push.calls).toContain('run'); expect(w.pull.calls).toContain('run')
    m.setEnabled(false)
    await expect(m.syncNow()).rejects.toThrow(/switched off/)
    const off = world({ activated: false })
    await expect(off.make().syncNow()).rejects.toThrow(/Activate a license/)
    const ro = world({ writable: false }); const rm = ro.make()
    rm.start()
    expect(ro.push.calls).toEqual([])
    expect(() => rm.setEnabled(false)).toThrow(/read-only/)
    expect(() => rm.retry()).toThrow(/read-only/)
    expect(rm.overview().readOnly).toBe(true)
  })

  it('watch() sends sync:status only when what the UI shows changed, and stops when asked', () => {
    const w = world(); const m = w.make()
    const stop = m.watch(1000)
    const tick = (): void => { const t = w.timers.pop()!; t.fn() }
    tick(); expect(w.sent).toHaveLength(1) // first look
    tick(); expect(w.sent).toHaveLength(1) // nothing changed
    w.st.push = pushSt({ lastRunAt: '2026-10-10T10:00:15.000Z', nextDelayMs: 30_000 })
    tick(); expect(w.sent).toHaveLength(1) // run clocks alone are not news
    w.outbox.repo.enqueue({ billId: 'x', revision: 1, op: 'upsert', at: '2026-10-10T10:00:00.000Z', keepSyncedBefore: '2000-01-01T00:00:00.000Z' })
    tick(); expect(w.sent).toHaveLength(2)
    expect((w.sent[1] as [string, { pending: number }])[1].pending).toBe(1)
    stop(); const before = w.timers.length
    w.timers.pop()?.fn()
    expect(w.timers.length).toBeLessThanOrEqual(before) // no new timer after stop
  })

  it('IPC: strict payloads; status / setEnabled / retry / now answer the overview', async () => {
    const w = world(); const m = w.make(); m.start()
    const h = syncHandlers(w.outbox, undefined, m)
    const call = async (ch: string, p: unknown): Promise<{ ok: boolean; data?: unknown; error?: { code: string } }> => (await h[ch]!(p)) as never
    expect(await call('sync:status', {})).toMatchObject({ ok: true, data: { mode: 'ok' } })
    expect((await call('sync:status', { extra: 1 })).ok).toBe(false)
    expect(await call('sync:setEnabled', { enabled: false })).toMatchObject({ ok: true, data: { mode: 'paused' } })
    expect((await call('sync:setEnabled', { enabled: 'no' })).ok).toBe(false)
    expect((await call('sync:setEnabled', {})).ok).toBe(false)
    expect(await call('sync:retry', {})).toMatchObject({ ok: true, data: { retried: 0 } })
    expect((await call('sync:retry', { ids: [0] })).ok).toBe(false)
    expect((await call('sync:retry', { ids: 'all' })).ok).toBe(false)
    expect(await call('sync:now', {})).toMatchObject({ ok: false }) // paused
    await call('sync:setEnabled', { enabled: true })
    expect(await call('sync:now', {})).toMatchObject({ ok: true })
  })

  it('REAL push worker: while paused a saved bill is queued but never sent; switching on sends it', async () => {
    const t = openTestDb(); dbs.push(t)
    const sqlite = t.handle.sqlite
    const local = getLocalBranch(sqlite).id
    const other = randomUUID()
    const mem = new InMemoryTransport(); mem.addLicense(LICENSE)
    await mem.registerBranch({ license: LICENSE, branchId: local, name: 'Main', poPrefix: 'AAA-', device: 'PC' })
    await mem.registerBranch({ license: LICENSE, branchId: other, name: 'Other', poPrefix: 'BBB-', device: 'PC' })
    const sync = createSyncStateRepo(sqlite)
    const outbox = createOutbox({ repo: createOutboxRepo(sqlite), capturing: () => true })
    const billRepo = createBillRepo(sqlite)
    const capture = (i: { billId: string; revision: number; op?: 'upsert' | 'delete' }): void => { outbox.capture({ billId: i.billId, revision: i.revision, op: i.op ?? 'upsert' }); pushWorker.kick() }
    const key = randomBytes(32)
    const pushWorker = createPushWorker({ outbox: outbox.repo, bills: billRepo, credentials: () => ({ url: 'https://x.supabase.co', anonKey: 'a', license: LICENSE, branchId: local }), encryptionKey: () => key, recipients: () => [other], makeTransport: () => mem, log })
    const pull = fakeWorker(() => pullSt())
    const m = createSyncManager({ license: { isActivated: () => true }, sync, push: pushWorker, pull, outbox, remote: { conflicts: () => [] }, emit: () => undefined, log }, { setTimer: () => 1, clearTimer: () => undefined })
    m.start(); m.setEnabled(false) // (sync_state is real, so the switch really persists)
    const bills = createBillService({ sqlite, bills: billRepo, parties: createPartyRepo(sqlite) }, { newId: () => `m-${++n}`, outbox: capture })
    const input: SaveBillInput = { bill: { id: U('p1'), party: { name: 'Ruby Traders', phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-10', rows: [row('Pen', '10', '9'), blankRow()] } }
    bills.save(input)
    expect(mem.postboxSize).toBe(0) // the capture hook kicked the worker, but it is stopped while paused
    expect(outbox.repo.counts().pending).toBe(1) // ... and the change is safely queued
    expect(m.overview()).toMatchObject({ mode: 'paused', pending: 1 })
    // The owner switches it on and presses Sync now.
    m.setEnabled(true)
    const after = await m.syncNow()
    expect(mem.postboxSize).toBe(1)
    expect(after).toMatchObject({ mode: 'ok', pending: 0 })
  })
})
