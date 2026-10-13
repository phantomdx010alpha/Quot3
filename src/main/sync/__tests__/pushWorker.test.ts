import { createHash, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createOutboxRepo } from '../../db/outboxRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createTrashRepo } from '../../db/trashRepo'
import { getLocalBranch } from '../../db/seed'
import { createBillService, type SaveBillInput } from '../../services/billService'
import { createTrashService } from '../../services/trashService'
import { createOutbox } from '../outbox'
import { open, partsToSealed } from '../crypto'
import { createPushWorker, type PushWorker } from '../pushWorker'
import { InMemoryTransport, TransportError, type PushArgs, type SyncTransport } from '../transport'
import { OUTBOX_MAX_ATTEMPTS } from '../../../shared/sync/outbox'
import { PUSH_INTERVAL_MS, PUSH_KICK_DELAY_MS, pushDelayMs } from '../../../shared/sync/push'
import { blankRow, row } from '../../../shared/__fixtures__/bills'
import { randomBytes } from 'node:crypto'

const LICENSE = 'Q3-ABCD-EFGH-JKLM'
const KEY = randomBytes(32)
const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
/** The server only accepts UUID bill ids, so the readable names used below are mapped to fixed UUIDs. */
const U = (name: string): string => `00000000-0000-4000-8000-${createHash('sha1').update(name).digest('hex').slice(0, 12)}`
const dbs: TestDb[] = []
afterEach(() => dbs.splice(0).forEach((t) => t.cleanup()))
let n = 0

/** InMemoryTransport with scripted trouble: `failNext` errors are thrown one per push call, `reject` refuses any push containing that bill. */
class Flaky implements SyncTransport {
  failNext: TransportError[] = []
  reject = new Set<string>()
  pushCalls: PushArgs[] = []
  constructor(readonly inner: InMemoryTransport) {}
  registerBranch: SyncTransport['registerBranch'] = (a) => this.inner.registerBranch(a)
  listBranches: SyncTransport['listBranches'] = (a) => this.inner.listBranches(a)
  touch: SyncTransport['touch'] = (a) => this.inner.touch(a)
  pendingCount: SyncTransport['pendingCount'] = (a) => this.inner.pendingCount(a)
  pull: SyncTransport['pull'] = (a) => this.inner.pull(a)
  ack: SyncTransport['ack'] = (a) => this.inner.ack(a)
  async push(a: PushArgs): Promise<{ ids: number[] }> {
    this.pushCalls.push(a)
    const f = this.failNext.shift()
    if (f) throw f
    if (a.items.some((i) => this.reject.has(i.billId))) throw new TransportError('invalid_input', 'Q3I01')
    return this.inner.push(a)
  }
}

async function world(opts: { others?: number } = {}) {
  const t = openTestDb(); dbs.push(t)
  const sqlite = t.handle.sqlite
  const local = getLocalBranch(sqlite).id
  const mem = new InMemoryTransport()
  mem.addLicense(LICENSE)
  const others = Array.from({ length: opts.others ?? 2 }, () => randomUUID())
  await mem.registerBranch({ license: LICENSE, branchId: local, name: 'Main', poPrefix: 'AAA-', device: 'PC' })
  for (const [i, id] of others.entries()) await mem.registerBranch({ license: LICENSE, branchId: id, name: `B${i}`, poPrefix: `B${i}-`, device: 'PC' })
  const flaky = new Flaky(mem)
  let clock = Date.UTC(2026, 9, 10, 10, 0, 0)
  const now = (): Date => new Date(clock)
  const outbox = createOutbox({ repo: createOutboxRepo(sqlite), capturing: () => true }, { now })
  const capture = (i: { billId: string; revision: number; op?: 'upsert' | 'delete' }): void => outbox.capture({ billId: i.billId, revision: i.revision, op: i.op ?? 'upsert' })
  const billRepo = createBillRepo(sqlite)
  const bills = createBillService({ sqlite, bills: billRepo, parties: createPartyRepo(sqlite) }, { now, newId: () => `pw-${++n}`, outbox: capture })
  const trash = createTrashService({ repo: createTrashRepo(sqlite), branchId: () => local }, { now, outbox: capture })
  const state = { key: KEY as Buffer | null, creds: true }
  const timers: { fn: () => void; ms: number; live: boolean }[] = []
  const make = (): PushWorker => createPushWorker(
    {
      outbox: outbox.repo, bills: billRepo,
      credentials: () => (state.creds ? { url: 'https://x.supabase.co', anonKey: 'anon', license: LICENSE, branchId: local } : null),
      encryptionKey: () => state.key, recipients: () => others, makeTransport: () => flaky, log
    },
    {
      now,
      setTimer: (fn, ms) => { const h = { fn: () => { h.live = false; fn() }, ms, live: true }; timers.push(h); return h },
      clearTimer: (h) => { (h as { live: boolean }).live = false }
    }
  )
  const outRows = (): { bill_id: string; op: string; state: string; attempts: number }[] =>
    sqlite.prepare('SELECT bill_id, op, state, attempts FROM sync_outbox ORDER BY id').all() as never
  const syncOf = (id: string): string => (sqlite.prepare('SELECT sync_state AS s FROM bills WHERE id = ?').get(id) as { s: string }).s
  return { sqlite, local, others, mem, flaky, bills, trash, outbox, state, make, timers, outRows, syncOf, advance: (ms: number): void => { clock += ms } }
}

const input = (id: string, qty = '10'): SaveBillInput => ({
  bill: {
    id: U(id), party: { name: 'Ruby Traders', phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null,
    billDate: '2026-10-10', rows: [row('Pen', qty, '9'), blankRow()]
  }
})

describe('push worker (Phase 55)', () => {
  it('seals the bill at push time and sends one copy to EVERY other branch; the rows become synced', async () => {
    const w = await world()
    const r = w.bills.save(input('b1'))
    const worker = w.make()
    const res = await worker.runOnce()
    expect(res).toMatchObject({ sent: 1, failedAttempts: 0, poisoned: 0, block: 'idle' })
    expect(w.outRows()).toEqual([{ bill_id: U('b1'), op: 'upsert', state: 'synced', attempts: 0 }])
    expect(w.syncOf(U('b1'))).toBe('synced')
    expect(w.mem.postboxSize).toBe(2) // fan-out: one per recipient
    for (const to of w.others) {
      const got = await w.mem.pull({ license: LICENSE, branchId: to, afterId: 0 })
      expect(got.items).toHaveLength(1)
      const it = got.items[0]!
      expect(it).toMatchObject({ fromBranch: w.local, billId: U('b1'), op: 'upsert', revision: r.revision })
      const snap = open(KEY, partsToSealed(it.nonce, it.ciphertext), U('b1'), r.revision) as { v: number; deleted: boolean; bill: { id: string; poNumber: string; syncState?: string }; rows: unknown[] }
      expect(snap).toMatchObject({ v: 1, deleted: false, bill: { id: U('b1'), poNumber: r.poNumber } })
      expect(snap.bill.syncState).toBeUndefined() // local-only bookkeeping never leaves the computer
      expect(snap.rows.length).toBeGreaterThan(0)
    }
    expect(worker.status()).toMatchObject({ block: 'idle', consecutiveFailures: 0, sentTotal: 1 })
    expect((await worker.runOnce()).sent).toBe(0) // nothing left
  })

  it('keeps the outbox order and batches several bills into one push call', async () => {
    const w = await world()
    for (const id of ['a', 'b', 'c']) w.bills.save(input(id))
    await w.make().runOnce()
    expect(w.flaky.pushCalls).toHaveLength(1)
    expect(w.flaky.pushCalls[0]!.items.filter((i) => i.toBranch === w.others[0]).map((i) => i.billId)).toEqual([U('a'), U('b'), U('c')])
    const got = await w.mem.pull({ license: LICENSE, branchId: w.others[1]!, afterId: 0 })
    expect(got.items.map((i) => i.billId)).toEqual([U('a'), U('b'), U('c')])
  })

  it('a delete / restore goes out as the matching op with the deleted flag', async () => {
    const w = await world({ others: 1 })
    w.bills.save(input('d1'))
    const worker = w.make()
    await worker.runOnce()
    w.bills.delete([U('d1')])
    await worker.runOnce()
    w.trash.restore([U('d1')])
    await worker.runOnce()
    const got = await w.mem.pull({ license: LICENSE, branchId: w.others[0]!, afterId: 0 })
    expect(got.items.map((i) => i.op)).toEqual(['upsert', 'delete', 'upsert'])
    const del = got.items[1]!
    expect((open(KEY, partsToSealed(del.nonce, del.ciphertext), U('d1'), del.revision) as { deleted: boolean }).deleted).toBe(true)
    expect(got.items.map((i) => i.revision)).toEqual([1, 2, 3])
  })

  it('offline: nothing is blamed on the rows, the wait doubles, and everything flows once the connection is back', async () => {
    const w = await world()
    w.bills.save(input('o1')); w.bills.save(input('o2'))
    const worker = w.make()
    worker.start()
    w.mem.offline = true
    const r1 = await worker.runOnce()
    expect(r1).toMatchObject({ sent: 0, failedAttempts: 0, block: 'offline' })
    expect(w.outRows().map((r) => [r.state, r.attempts])).toEqual([['pending', 0], ['pending', 0]])
    expect(worker.status()).toMatchObject({ block: 'offline', consecutiveFailures: 1, nextDelayMs: pushDelayMs(1) })
    await worker.runOnce()
    expect(worker.status().consecutiveFailures).toBe(2)
    expect(w.timers.filter((t) => t.live).at(-1)!.ms).toBe(pushDelayMs(2)) // the next run is scheduled with the backed-off wait
    worker.kick() // a save while backing off does not hammer the server
    const live = w.timers.filter((t) => t.live).length
    worker.kick()
    expect(w.timers.filter((t) => t.live).length).toBe(live)
    w.mem.offline = false
    worker.notifyOnline()
    expect(worker.status().consecutiveFailures).toBe(0)
    expect(await worker.runOnce()).toMatchObject({ sent: 2, block: 'idle' })
    expect(w.outRows().every((r) => r.state === 'synced')).toBe(true)
    worker.stop()
  })

  it('a flaky push (fails twice, then works) sends each change exactly once per recipient', async () => {
    const w = await world()
    w.bills.save(input('f1'))
    w.flaky.failNext = [new TransportError('timeout'), new TransportError('server')]
    const worker = w.make()
    await worker.runOnce(); await worker.runOnce()
    expect(w.mem.postboxSize).toBe(0)
    expect(w.outRows()[0]).toMatchObject({ state: 'pending', attempts: 0 })
    await worker.runOnce()
    expect(w.mem.postboxSize).toBe(2)
    expect(w.outRows()[0]).toMatchObject({ state: 'synced' })
  })

  it('poison: a request the server refuses is isolated, counted against that row only, and becomes failed after 10 attempts', async () => {
    const w = await world()
    w.bills.save(input('bad')); w.bills.save(input('good'))
    w.flaky.reject.add(U('bad'))
    const worker = w.make()
    const r1 = await worker.runOnce()
    expect(r1).toMatchObject({ sent: 1, failedAttempts: 1, poisoned: 0, block: 'idle' })
    expect(w.outRows()).toEqual([
      { bill_id: U('bad'), op: 'upsert', state: 'pending', attempts: 1 },
      { bill_id: U('good'), op: 'upsert', state: 'synced', attempts: 0 }
    ])
    expect(w.syncOf(U('good'))).toBe('synced')
    expect(w.syncOf(U('bad'))).toBe('pending')
    let poisoned = 0
    for (let i = 1; i < OUTBOX_MAX_ATTEMPTS; i++) poisoned += (await worker.runOnce()).poisoned
    expect(poisoned).toBe(1)
    expect(w.outRows()[0]).toMatchObject({ bill_id: U('bad'), state: 'failed', attempts: OUTBOX_MAX_ATTEMPTS })
    const calls = w.flaky.pushCalls.length
    await worker.runOnce()
    expect(w.flaky.pushCalls.length).toBe(calls) // a failed row is left alone until the owner retries
    expect(w.outbox.repo.retryFailed()).toBe(1)
    w.flaky.reject.clear()
    expect((await worker.runOnce()).sent).toBe(1)
    expect(w.syncOf(U('bad'))).toBe('synced')
  })

  it('a license problem or a missing key pauses the worker without blaming any row', async () => {
    const w = await world()
    w.bills.save(input('l1'))
    const worker = w.make()
    w.mem.suspend(LICENSE)
    expect(await worker.runOnce()).toMatchObject({ sent: 0, failedAttempts: 0, block: 'license' })
    expect(w.outRows()[0]).toMatchObject({ state: 'pending', attempts: 0 })
    w.state.key = null
    expect(await worker.runOnce()).toMatchObject({ block: 'no_key', sent: 0 })
    w.state.creds = false
    expect(await worker.runOnce()).toMatchObject({ block: 'not_activated' })
    expect(w.outRows()[0]).toMatchObject({ state: 'pending', attempts: 0 })
  })

  it('resumes after a restart: a brand-new worker sends what the old one left pending', async () => {
    const w = await world()
    w.bills.save(input('r1')); w.bills.save(input('r2'))
    const first = w.make()
    w.mem.offline = true
    await first.runOnce()
    first.stop()
    w.mem.offline = false
    const second = w.make() // new process: no in-memory state at all
    expect(second.status().consecutiveFailures).toBe(0)
    expect(await second.runOnce()).toMatchObject({ sent: 2, block: 'idle' })
    expect(w.mem.postboxSize).toBe(4)
  })

  it('with no other branch registered yet, changes are settled (nothing to deliver) instead of piling up', async () => {
    const w = await world({ others: 0 })
    w.bills.save(input('s1'))
    expect(await w.make().runOnce()).toMatchObject({ sent: 1, block: 'idle' })
    expect(w.outRows()[0]).toMatchObject({ state: 'synced' })
    expect(w.mem.postboxSize).toBe(0)
    expect(w.flaky.pushCalls).toHaveLength(0)
  })

  it('a branch that joined after activation is picked up from the server list', async () => {
    const w = await world({ others: 1 })
    const late = randomUUID()
    await w.mem.registerBranch({ license: LICENSE, branchId: late, name: 'Late', poPrefix: 'LAT-', device: 'PC' })
    w.bills.save(input('j1'))
    await w.make().runOnce()
    expect((await w.mem.pull({ license: LICENSE, branchId: late, afterId: 0 })).items).toHaveLength(1)
  })

  it('a sealing failure blames only that row, the rest still go out', async () => {
    const w = await world()
    w.bills.save(input('k1')); w.bills.save(input('k2'))
    w.state.key = Buffer.alloc(5) // not a valid AES-256 key: every seal throws
    const bad = await w.make().runOnce()
    expect(bad.failedAttempts).toBe(2)
    expect(w.outRows().map((r) => r.attempts)).toEqual([1, 1])
    w.state.key = KEY
    expect((await w.make().runOnce()).sent).toBe(2)
  })

  it('start() runs soon, kick() coalesces, stop() cancels every timer', async () => {
    const w = await world()
    const worker = w.make()
    worker.start(); worker.start()
    expect(w.timers.filter((t) => t.live).map((t) => t.ms)).toEqual([PUSH_KICK_DELAY_MS])
    worker.kick(); worker.kick()
    expect(w.timers.filter((t) => t.live)).toHaveLength(1)
    w.timers[0]!.fn()
    await worker.runOnce()
    expect(w.timers.filter((t) => t.live).at(-1)!.ms).toBe(PUSH_INTERVAL_MS)
    worker.stop()
    expect(w.timers.some((t) => t.live)).toBe(false)
    worker.kick()
    expect(w.timers.some((t) => t.live)).toBe(false)
    expect(worker.status().block).toBe('stopped')
  })

  it('two overlapping runOnce calls share one run', async () => {
    const w = await world()
    w.bills.save(input('p1'))
    const worker = w.make()
    const [a, b] = await Promise.all([worker.runOnce(), worker.runOnce()])
    expect(a).toBe(b)
    expect(w.mem.postboxSize).toBe(2)
  })
})
