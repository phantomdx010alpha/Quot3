import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createOutboxRepo } from '../../db/outboxRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createRemoteApplyRepo } from '../../db/remoteApplyRepo'
import { createSyncStateRepo } from '../../db/syncStateRepo'
import { createTrashRepo } from '../../db/trashRepo'
import { getLocalBranch } from '../../db/seed'
import { syncHandlers } from '../../ipc/sync'
import { createBillService, type SaveBillInput } from '../../services/billService'
import { createTrashService } from '../../services/trashService'
import { createOutbox } from '../outbox'
import { createPullWorker, PULL_KEYS } from '../pullWorker'
import { createPushWorker } from '../pushWorker'
import { createRemoteApplier } from '../remoteApplier'
import { InMemoryTransport, TransportError, type PullArgs, type SyncTransport } from '../transport'

type AckArgsLike = Parameters<SyncTransport['ack']>[0]
import { PULL_SKIP_AFTER_ATTEMPTS, incomingWins, pullDelayMs, type RemoteChangedEvent } from '../../../shared/sync/pull'
import { blankRow, row } from '../../../shared/__fixtures__/bills'

const LICENSE = 'Q3-ABCD-EFGH-JKLM'
const KEY = randomBytes(32)
const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const U = (name: string): string => `00000000-0000-4000-8000-${createHash('sha1').update(name).digest('hex').slice(0, 12)}`
const dbs: TestDb[] = []
afterEach(() => dbs.splice(0).forEach((t) => t.cleanup()))
let n = 0

/** Scripted trouble on the receiving side. */
class Flaky implements SyncTransport {
  ackFailures: TransportError[] = []
  constructor(readonly inner: InMemoryTransport) {}
  registerBranch: SyncTransport['registerBranch'] = (a) => this.inner.registerBranch(a)
  listBranches: SyncTransport['listBranches'] = (a) => this.inner.listBranches(a)
  touch: SyncTransport['touch'] = (a) => this.inner.touch(a)
  pendingCount: SyncTransport['pendingCount'] = (a) => this.inner.pendingCount(a)
  push: SyncTransport['push'] = (a) => this.inner.push(a)
  pull: (a: PullArgs) => ReturnType<SyncTransport['pull']> = (a) => this.inner.pull(a)
  async ack(a: AckArgsLike): ReturnType<SyncTransport['ack']> {
    const f = this.ackFailures.shift()
    if (f) throw f
    return this.inner.ack(a)
  }
}

function branch(mem: InMemoryTransport, flaky: Flaky, name: string, prefix: string) {
  const t = openTestDb(); dbs.push(t)
  const sqlite = t.handle.sqlite
  const id = getLocalBranch(sqlite).id
  let clock = Date.UTC(2026, 9, 10, 10, 0, 0)
  const now = (): Date => new Date(clock)
  const outbox = createOutbox({ repo: createOutboxRepo(sqlite), capturing: () => true }, { now })
  const capture = (i: { billId: string; revision: number; op?: 'upsert' | 'delete' }): void => outbox.capture({ billId: i.billId, revision: i.revision, op: i.op ?? 'upsert' })
  const billRepo = createBillRepo(sqlite)
  const bills = createBillService({ sqlite, bills: billRepo, parties: createPartyRepo(sqlite) }, { now, newId: () => randomUUID(), outbox: capture })
  const trash = createTrashService({ repo: createTrashRepo(sqlite), branchId: () => id }, { now, outbox: capture })
  const creds = { url: 'https://x.supabase.co', anonKey: 'anon', license: LICENSE, branchId: id }
  const push = createPushWorker({ outbox: outbox.repo, bills: billRepo, credentials: () => creds, encryptionKey: () => KEY, recipients: () => [], makeTransport: () => flaky, log })
  const sync = createSyncStateRepo(sqlite)
  const repo = createRemoteApplyRepo(sqlite)
  const events: RemoteChangedEvent[] = []
  const applier = createRemoteApplier({ repo, sync, localBranchId: () => id, log, emit: (_c, p) => { events.push(p) } }, { now })
  const state = { key: KEY as Buffer }
  const make = () => createPullWorker({ sync, repo, applier, credentials: () => creds, encryptionKey: () => state.key, makeTransport: () => flaky, emit: (_c, p) => { events.push(p) }, log })
  const q = <T>(sql: string, ...a: unknown[]): T[] => sqlite.prepare(sql).all(...a) as T[]
  return { id, name, prefix, sqlite, bills, trash, outbox, push, sync, repo, applier, events, state, make, q, advance: (ms: number): void => { clock += ms } }
}

async function world() {
  const mem = new InMemoryTransport()
  mem.addLicense(LICENSE)
  const flaky = new Flaky(mem)
  const a = branch(mem, flaky, 'A', 'AAA-'), b = branch(mem, flaky, 'B', 'BBB-')
  for (const x of [a, b]) await mem.registerBranch({ license: LICENSE, branchId: x.id, name: x.name, poPrefix: x.prefix, device: 'PC' })
  const pushA = createPushWorker({ outbox: a.outbox.repo, bills: createBillRepo(a.sqlite), credentials: () => ({ url: 'u', anonKey: 'k', license: LICENSE, branchId: a.id }), encryptionKey: () => KEY, recipients: () => [b.id], makeTransport: () => flaky, log })
  return { mem, flaky, a, b, pushA }
}

const input = (id: string, qty = '10', party = 'Ruby Traders'): SaveBillInput => ({
  bill: {
    id: U(id), party: { name: party, phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null,
    billDate: '2026-10-10', rows: [row('Pen', qty, '9'), blankRow()]
  }
})
const bill = (b: ReturnType<typeof branch>, id: string): { revision: number; updatedAt: string; deletedAt: string | null; syncState: string; branchId: string; poNumber: string } | undefined =>
  b.q<{ revision: number; updatedAt: string; deletedAt: string | null; syncState: string; branchId: string; poNumber: string }>(
    'SELECT revision, updated_at AS updatedAt, deleted_at AS deletedAt, sync_state AS syncState, branch_id AS branchId, po_number AS poNumber FROM bills WHERE id = ?', U(id)
  )[0]
const rowsOf = (b: ReturnType<typeof branch>, id: string): string[] => b.q<{ name_plain: string; qty: string | null }>('SELECT name_plain, qty FROM bill_rows WHERE bill_id = ? ORDER BY idx', U(id)).map((r) => `${r.name_plain}:${r.qty}`)

describe('pull, apply, acknowledge (Phase 56)', () => {
  it('a bill saved on A arrives on B intact, is acknowledged, and is never echoed back out', async () => {
    const w = await world()
    const saved = w.a.bills.save(input('b1'))
    await w.pushA.runOnce()
    const worker = w.b.make()
    const res = await worker.runOnce()
    expect(res).toMatchObject({ received: 1, applied: 1, ignored: 0, held: 0, block: 'idle' })
    expect(bill(w.b, 'b1')).toMatchObject({ revision: saved.revision, syncState: 'synced', branchId: w.a.id, poNumber: saved.poNumber, deletedAt: null })
    expect(rowsOf(w.b, 'b1')).toEqual(rowsOf(w.a, 'b1'))
    expect(w.b.q('SELECT 1 FROM branches WHERE id = ?', w.a.id)).toHaveLength(1) // the origin branch became known
    expect(w.b.q('SELECT 1 FROM bill_revisions WHERE bill_id = ?', U('b1'))).toHaveLength(1)
    expect(w.b.q('SELECT 1 FROM sync_outbox')).toHaveLength(0) // nothing to send back
    expect(w.mem.postboxSize).toBe(0) // acknowledged
    expect(worker.status()).toMatchObject({ cursor: 1, unacked: 0, appliedTotal: 1, held: [] })
    expect(w.b.events).toEqual([{ id: U('b1'), held: false }])
    expect((await worker.runOnce()).received).toBe(0)
  })

  it('replay safety: the very same change delivered twice is applied once', async () => {
    const w = await world()
    w.a.bills.save(input('r1'))
    await w.pushA.runOnce()
    const copy = (await w.mem.pull({ license: LICENSE, branchId: w.b.id, afterId: 0 })).items[0]!
    const worker = w.b.make()
    expect(await worker.runOnce()).toMatchObject({ applied: 1 })
    const before = bill(w.b, 'r1')
    // A re-sends the identical row (e.g. a crash on A between the server accepting it and marking it sent).
    await w.mem.push({ license: LICENSE, branchId: w.a.id, items: [{ toBranch: w.b.id, billId: copy.billId, op: copy.op, revision: copy.revision, updatedAt: copy.updatedAt, nonce: copy.nonce, ciphertext: copy.ciphertext }] })
    expect(await worker.runOnce()).toMatchObject({ received: 1, applied: 0, ignored: 1, block: 'idle' })
    expect(bill(w.b, 'r1')).toEqual(before)
    expect(w.b.q('SELECT 1 FROM bill_revisions WHERE bill_id = ?', U('r1'))).toHaveLength(1)
    expect(w.b.q('SELECT 1 FROM bill_rows WHERE bill_id = ?', U('r1')).length).toBe(w.a.q('SELECT 1 FROM bill_rows WHERE bill_id = ?', U('r1')).length)
    expect(w.mem.postboxSize).toBe(0)
  })

  it('an update replaces the rows; an older change that arrives later is dropped; a delete is a tombstone and a restore brings it back', async () => {
    const w = await world()
    const worker = w.b.make()
    w.a.bills.save(input('u1', '10'))
    await w.pushA.runOnce(); await worker.runOnce()
    expect(rowsOf(w.b, 'u1')[0]).toBe('Pen:10')
    w.a.advance(60_000)
    w.a.bills.save(input('u1', '25'))
    await w.pushA.runOnce(); await worker.runOnce()
    expect(rowsOf(w.b, 'u1')[0]).toBe('Pen:25')
    expect(bill(w.b, 'u1')?.revision).toBe(2)
    w.a.advance(60_000)
    w.a.bills.delete([U('u1')])
    await w.pushA.runOnce(); await worker.runOnce()
    expect(bill(w.b, 'u1')).toMatchObject({ revision: 3, deletedAt: expect.any(String) })
    w.a.advance(60_000)
    w.a.trash.restore([U('u1')])
    await w.pushA.runOnce(); await worker.runOnce()
    expect(bill(w.b, 'u1')).toMatchObject({ revision: 4, deletedAt: null })
    expect(w.b.q('SELECT 1 FROM bill_revisions WHERE bill_id = ?', U('u1')).length).toBe(4)
  })

  it('crash between apply and acknowledge: the change is not applied twice and the acknowledgement goes out next time', async () => {
    const w = await world()
    w.a.bills.save(input('c1'))
    await w.pushA.runOnce()
    w.flaky.ackFailures = [new TransportError('offline')]
    const first = w.b.make()
    const r1 = await first.runOnce()
    expect(r1).toMatchObject({ applied: 1, block: 'offline' })
    expect(first.status()).toMatchObject({ cursor: 1, unacked: 1 })
    expect(w.mem.postboxSize).toBe(1) // the server still holds it
    expect(bill(w.b, 'c1')).toBeDefined()
    const second = w.b.make() // restart: no memory, only the database
    const r2 = await second.runOnce()
    expect(r2).toMatchObject({ received: 0, applied: 0, block: 'idle' })
    expect(w.mem.postboxSize).toBe(0)
    expect(second.status().unacked).toBe(0)
    expect(w.b.q('SELECT 1 FROM bill_revisions WHERE bill_id = ?', U('c1'))).toHaveLength(1)
  })

  it('decrypt failure keeps the row unacknowledged and stops there; after 10 runs it is skipped so later changes still arrive', async () => {
    const w = await world()
    // A garbage row from A addressed to B, then a good bill.
    await w.mem.push({ license: LICENSE, branchId: w.a.id, items: [{ toBranch: w.b.id, billId: U('x'), op: 'upsert', revision: 1, updatedAt: '2026-10-10T10:00:00.000Z', nonce: randomBytes(12).toString('base64'), ciphertext: randomBytes(64).toString('base64') }] })
    w.a.bills.save(input('g1'))
    await w.pushA.runOnce()
    const worker = w.b.make()
    for (let i = 1; i < PULL_SKIP_AFTER_ATTEMPTS; i++) {
      expect(await worker.runOnce()).toMatchObject({ applied: 0, block: 'decrypt' })
    }
    expect(bill(w.b, 'g1')).toBeUndefined()
    expect(worker.status()).toMatchObject({ cursor: 0, block: 'decrypt' })
    expect(w.mem.postboxSize).toBe(2)
    const last = await worker.runOnce()
    expect(last).toMatchObject({ skipped: 1, applied: 1, block: 'idle' })
    expect(bill(w.b, 'g1')).toBeDefined()
    expect(worker.status().skipped).toEqual([expect.objectContaining({ id: 1, billId: U('x') })])
    expect(w.mem.postboxSize).toBe(1) // only the garbage row is left on the server, never acknowledged
  })

  it('a wrong key is reported as a decrypt problem and nothing is applied or acknowledged', async () => {
    const w = await world()
    w.a.bills.save(input('k1'))
    await w.pushA.runOnce()
    w.b.state.key = randomBytes(32)
    const worker = w.b.make()
    expect(await worker.runOnce()).toMatchObject({ applied: 0, block: 'decrypt' })
    expect(worker.status().lastError).toBeTruthy()
    expect(w.mem.postboxSize).toBe(1)
    expect(bill(w.b, 'k1')).toBeUndefined()
  })

  it('offline pauses without moving the cursor; license / key / not-activated block quietly', async () => {
    const w = await world()
    w.a.bills.save(input('o1'))
    await w.pushA.runOnce()
    const worker = w.b.make()
    w.mem.offline = true
    expect(await worker.runOnce()).toMatchObject({ block: 'offline', received: 0 })
    expect(worker.status()).toMatchObject({ cursor: 0, consecutiveFailures: 1, nextDelayMs: pullDelayMs(1) })
    w.mem.offline = false
    worker.start(); worker.notifyOnline()
    expect(worker.status().consecutiveFailures).toBe(0)
    expect(await worker.runOnce()).toMatchObject({ applied: 1, block: 'idle' })
    worker.stop()
    w.mem.suspend(LICENSE)
    expect(await w.b.make().runOnce()).toMatchObject({ block: 'license' })
  })

  it('the bill open in the editor is never touched: a winning change is held, Load theirs applies it, Keep mine drops it', async () => {
    const w = await world()
    const worker = w.b.make()
    w.a.bills.save(input('e1', '10'))
    await w.pushA.runOnce(); await worker.runOnce()
    w.b.events.length = 0
    w.b.applier.setOpenBill(U('e1'))

    w.a.advance(60_000)
    w.a.bills.save(input('e1', '30'))
    await w.pushA.runOnce()
    const res = await worker.runOnce()
    expect(res).toMatchObject({ held: 1, applied: 0 })
    expect(rowsOf(w.b, 'e1')[0]).toBe('Pen:10') // untouched
    expect(w.mem.postboxSize).toBe(0) // but safely received and acknowledged
    expect(w.b.events).toEqual([{ id: U('e1'), held: true }])
    expect(w.b.applier.held()).toEqual([expect.objectContaining({ billId: U('e1'), fromBranch: w.a.id, revision: 2, deleted: false })])

    // A newer change replaces the held one.
    w.a.advance(60_000)
    w.a.bills.save(input('e1', '40'))
    await w.pushA.runOnce(); await worker.runOnce()
    expect(w.b.applier.held()).toHaveLength(1)
    expect(w.b.applier.held()[0]!.revision).toBe(3)

    w.b.events.length = 0
    expect(w.b.applier.resolve(U('e1'), 'load')).toEqual({ done: true })
    expect(rowsOf(w.b, 'e1')[0]).toBe('Pen:40')
    expect(bill(w.b, 'e1')?.revision).toBe(3)
    expect(w.b.events).toEqual([{ id: U('e1'), held: false }])
    expect(w.b.applier.held()).toEqual([])
    expect(w.b.applier.resolve(U('e1'), 'load')).toEqual({ done: false })

    w.a.advance(60_000)
    w.a.bills.save(input('e1', '50'))
    await w.pushA.runOnce(); await worker.runOnce()
    expect(w.b.applier.resolve(U('e1'), 'keep')).toEqual({ done: true })
    expect(rowsOf(w.b, 'e1')[0]).toBe('Pen:40')
    expect(w.b.applier.held()).toEqual([])
  })

  it('moving the editor to another bill releases a held change by the normal ordering', async () => {
    const w = await world()
    const worker = w.b.make()
    w.a.bills.save(input('m1', '10'))
    await w.pushA.runOnce(); await worker.runOnce()
    w.b.applier.setOpenBill(U('m1'))
    w.a.advance(60_000)
    w.a.bills.save(input('m1', '77'))
    await w.pushA.runOnce(); await worker.runOnce()
    expect(rowsOf(w.b, 'm1')[0]).toBe('Pen:10')
    w.b.events.length = 0
    w.b.applier.setOpenBill(null)
    expect(rowsOf(w.b, 'm1')[0]).toBe('Pen:77')
    expect(w.b.events).toEqual([{ id: U('m1'), held: false }])
    expect(w.b.applier.held()).toEqual([])
  })

  it('a held change that loses to a local edit made meanwhile is dropped on release', async () => {
    const w = await world()
    const worker = w.b.make()
    w.a.bills.save(input('d1', '10'))
    await w.pushA.runOnce(); await worker.runOnce()
    w.b.applier.setOpenBill(U('d1'))
    w.a.advance(60_000)
    w.a.bills.save(input('d1', '11'))
    await w.pushA.runOnce(); await worker.runOnce()
    expect(w.b.applier.held()).toHaveLength(1)
    // The owner edits locally and saves (a later time and a higher revision), then leaves the bill.
    w.b.advance(10 * 60_000)
    w.b.bills.save({ bill: { ...input('d1', '99').bill, id: U('d1') } })
    w.b.applier.setOpenBill(null)
    expect(rowsOf(w.b, 'd1')[0]).toBe('Pen:99')
    expect(w.b.applier.held()).toEqual([])
  })

  it('sync:editor / sync:held / sync:resolveHeld validate strictly', async () => {
    const w = await world()
    const h = syncHandlers(w.b.outbox, w.b.applier)
    expect(await h['sync:editor']!({ billId: U('z'), extra: 1 })).toMatchObject({ ok: false })
    expect(await h['sync:editor']!({ billId: U('z') })).toMatchObject({ ok: true })
    expect(w.b.applier.openBill()).toBe(U('z'))
    expect(await h['sync:editor']!({ billId: null })).toMatchObject({ ok: true })
    expect(w.b.applier.openBill()).toBeNull()
    expect(await h['sync:held']!({})).toMatchObject({ ok: true, data: [] })
    expect(await h['sync:resolveHeld']!({ billId: U('z'), choice: 'maybe' })).toMatchObject({ ok: false })
    expect(await h['sync:resolveHeld']!({ billId: U('z'), choice: 'keep' })).toMatchObject({ ok: true, data: { done: false } })
  })

  it('a change from a branch that is not listed is not applied and is counted as a failing row', async () => {
    const w = await world()
    w.a.bills.save(input('n1'))
    await w.pushA.runOnce()
    // B's server list does not know A any more: make listBranches return nobody.
    w.flaky.listBranches = async () => []
    const worker = w.b.make()
    expect(await worker.runOnce()).toMatchObject({ applied: 0, block: 'decrypt' })
    expect(worker.status().lastError).toMatch(/not list/)
    expect(w.b.sync.get(PULL_KEYS.cursor)).toBeUndefined()
    expect(bill(w.b, 'n1')).toBeUndefined()
  })
})

describe('ordering rule', () => {
  const s = (updatedAt: string, revision: number, branchId: string) => ({ updatedAt, revision, branchId })
  it('newer time, then higher revision, then greater branch id; equal never wins', () => {
    expect(incomingWins(null, s('2026-10-10T10:00:00.000Z', 1, 'a'))).toBe(true)
    expect(incomingWins(s('2026-10-10T10:00:00.000Z', 5, 'z'), s('2026-10-10T10:00:01.000Z', 1, 'a'))).toBe(true)
    expect(incomingWins(s('2026-10-10T10:00:01.000Z', 1, 'a'), s('2026-10-10T10:00:00.000Z', 9, 'z'))).toBe(false)
    expect(incomingWins(s('2026-10-10T10:00:00.000Z', 1, 'z'), s('2026-10-10T10:00:00.000Z', 2, 'a'))).toBe(true)
    expect(incomingWins(s('2026-10-10T10:00:00.000Z', 2, 'a'), s('2026-10-10T10:00:00.000Z', 2, 'b'))).toBe(true)
    expect(incomingWins(s('2026-10-10T10:00:00.000Z', 2, 'b'), s('2026-10-10T10:00:00.000Z', 2, 'a'))).toBe(false)
    expect(incomingWins(s('2026-10-10T10:00:00.000Z', 2, 'a'), s('2026-10-10T10:00:00.000Z', 2, 'a'))).toBe(false)
  })
  it('pullDelayMs: 30 s, doubling, capped at 10 minutes', () => {
    expect([0, 1, 2, 3, 4, 5].map(pullDelayMs)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 600_000])
    expect(pullDelayMs(99)).toBe(600_000)
  })
})
