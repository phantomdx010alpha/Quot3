import { randomBytes, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createOutboxRepo } from '../../db/outboxRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createRemoteApplyRepo } from '../../db/remoteApplyRepo'
import { createSyncStateRepo } from '../../db/syncStateRepo'
import { getLocalBranch } from '../../db/seed'
import { createBillService, type SaveBillInput } from '../../services/billService'
import { createOutbox } from '../outbox'
import { createPullWorker } from '../pullWorker'
import { createPushWorker } from '../pushWorker'
import { createRemoteApplier } from '../remoteApplier'
import { InMemoryTransport, TransportError, type SyncTransport } from '../transport'
import type { SyncProgress } from '../../../shared/sync/progress'
import { blankRow, row } from '../../../shared/__fixtures__/bills'

const LICENSE = 'Q3-ABCD-EFGH-JKLM'
const KEY = randomBytes(32)
const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const dbs: TestDb[] = []
afterEach(() => dbs.splice(0).forEach((t) => t.cleanup()))
const BASE = Date.parse('2026-10-10T10:00:00.000Z')

function branch(mem: SyncTransport, events: SyncProgress[]) {
  const t = openTestDb(); dbs.push(t)
  const sqlite = t.handle.sqlite
  const id = getLocalBranch(sqlite).id
  const now = (): Date => new Date(BASE)
  const outbox = createOutbox({ repo: createOutboxRepo(sqlite), capturing: () => true }, { now })
  const billRepo = createBillRepo(sqlite)
  const bills = createBillService({ sqlite, bills: billRepo, parties: createPartyRepo(sqlite) }, { now, newId: () => randomUUID(), outbox: (i) => outbox.capture({ billId: i.billId, revision: i.revision, op: i.op ?? 'upsert' }) })
  const sync = createSyncStateRepo(sqlite)
  const repo = createRemoteApplyRepo(sqlite)
  const applier = createRemoteApplier({ repo, sync, localBranchId: () => id, log, emit: () => undefined }, { now })
  const creds = { url: 'u', anonKey: 'k', license: LICENSE, branchId: id }
  return {
    id, outbox, bills, creds, billRepo,
    pull: createPullWorker({ sync, repo, applier, credentials: () => creds, encryptionKey: () => KEY, makeTransport: () => mem, emit: () => undefined, log, progress: (p) => events.push(p) }),
    makePush: (others: string[]) => createPushWorker({ outbox: outbox.repo, bills: billRepo, credentials: () => creds, encryptionKey: () => KEY, recipients: () => others, makeTransport: () => mem, log, progress: (p) => events.push(p) })
  }
}
const save = (i: number): SaveBillInput => ({
  bill: { id: randomUUID(), party: { name: `P${i}`, phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-10', rows: [row('Pen', '1', '9'), blankRow()] }
})
async function setup(mem: SyncTransport, inner: InMemoryTransport) {
  inner.addLicense(LICENSE, { maxBranches: 5 })
  const sendEv: SyncProgress[] = [], recvEv: SyncProgress[] = []
  const a = branch(mem, sendEv), b = branch(mem, recvEv)
  for (const [x, p] of [[a, 'AAA-'], [b, 'BBB-']] as const) await inner.registerBranch({ license: LICENSE, branchId: x.id, name: p, poPrefix: p, device: 'PC' })
  return { a, b, sendEv, recvEv }
}

describe('progress events (Phase 89)', () => {
  it('sender: "Sending N of M" climbs to M and closes; receiver: counts come from the server (qt_pending_count)', async () => {
    const mem = new InMemoryTransport()
    const { a, b, sendEv, recvEv } = await setup(mem, mem)
    for (let i = 0; i < 450; i++) a.bills.save(save(i))
    await a.makePush([b.id]).runOnce()
    expect(sendEv[0]).toEqual({ direction: 'send', done: 0, total: 450, active: true })
    expect(sendEv.at(-1)).toEqual({ direction: 'send', done: 450, total: 450, active: false })
    expect(sendEv.filter((e) => e.active).length).toBeGreaterThan(2)
    const dones = sendEv.map((e) => e.done)
    expect([...dones].sort((x, y) => x - y)).toEqual(dones)
    expect(mem.calls.some((c) => c.fn === 'qt_pending_count')).toBe(false)

    for (let i = 0; i < 6; i++) await b.pull.runOnce()
    expect(recvEv[0]).toEqual({ direction: 'receive', done: 0, total: 450, active: true })
    expect(recvEv.at(-1)).toEqual({ direction: 'receive', done: 450, total: 450, active: false })
    expect(mem.calls.some((c) => c.fn === 'qt_pending_count')).toBe(true)
  }, 120_000)

  it('an empty run emits nothing', async () => {
    const mem = new InMemoryTransport()
    const { a, b, sendEv, recvEv } = await setup(mem, mem)
    await a.makePush([b.id]).runOnce(); await b.pull.runOnce()
    expect(sendEv).toEqual([]); expect(recvEv).toEqual([])
  })

  it('a server without the count function (not_installed) still receives: the bar just grows with what arrives', async () => {
    const mem = new InMemoryTransport()
    const noCount: SyncTransport = {
      registerBranch: (x) => mem.registerBranch(x), listBranches: (x) => mem.listBranches(x), touch: (x) => mem.touch(x), push: (x) => mem.push(x),
      pull: (x) => mem.pull(x), ack: (x) => mem.ack(x), pendingCount: async () => { throw new TransportError('not_installed', 'PGRST202') }
    }
    const { a, b, recvEv } = await setup(noCount, mem)
    for (let i = 0; i < 5; i++) a.bills.save(save(i))
    await a.makePush([b.id]).runOnce()
    const r = await b.pull.runOnce()
    expect(r.applied).toBe(5)
    expect(recvEv.at(-1)).toEqual({ direction: 'receive', done: 5, total: 5, active: false })
  })

  it('offline while counting pauses the run like any other call (no rows lost)', async () => {
    const mem = new InMemoryTransport()
    const { a, b } = await setup(mem, mem)
    a.bills.save(save(1))
    await a.makePush([b.id]).runOnce()
    mem.offline = true
    const r = await b.pull.runOnce()
    expect(r.block).toBe('offline')
    mem.offline = false
    expect((await b.pull.runOnce()).applied).toBe(1)
  })
})
