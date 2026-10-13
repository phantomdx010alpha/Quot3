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
import { createPullWorker } from '../pullWorker'
import { createPushWorker } from '../pushWorker'
import { createRemoteApplier } from '../remoteApplier'
import { InMemoryTransport } from '../transport'
import { incomingWins, type RemoteSnapshot } from '../../../shared/sync/pull'
import { conflictDetailSchema } from '../../../shared/sync/conflict'
import { blankRow, row } from '../../../shared/__fixtures__/bills'

const LICENSE = 'Q3-ABCD-EFGH-JKLM'
const KEY = randomBytes(32)
const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const U = (name: string): string => `00000000-0000-4000-8000-${createHash('sha1').update(name).digest('hex').slice(0, 12)}`
const BASE = Date.UTC(2026, 9, 10, 10, 0, 0)
const dbs: TestDb[] = []
afterEach(() => dbs.splice(0).forEach((t) => t.cleanup()))

/** Small seeded PRNG so a failing seed can be replayed. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function branch(mem: InMemoryTransport, name: string) {
  const t = openTestDb(); dbs.push(t)
  const sqlite = t.handle.sqlite
  const id = getLocalBranch(sqlite).id
  let clock = BASE
  const now = (): Date => new Date(clock)
  const outbox = createOutbox({ repo: createOutboxRepo(sqlite), capturing: () => true }, { now })
  const capture = (i: { billId: string; revision: number; op?: 'upsert' | 'delete' }): void => outbox.capture({ billId: i.billId, revision: i.revision, op: i.op ?? 'upsert' })
  const billRepo = createBillRepo(sqlite)
  const bills = createBillService({ sqlite, bills: billRepo, parties: createPartyRepo(sqlite) }, { now, newId: () => randomUUID(), outbox: capture })
  const trash = createTrashService({ repo: createTrashRepo(sqlite), branchId: () => id }, { now, outbox: capture })
  const sync = createSyncStateRepo(sqlite)
  const repo = createRemoteApplyRepo(sqlite)
  const applier = createRemoteApplier({ repo, sync, localBranchId: () => id, log, emit: () => undefined }, { now })
  const creds = { url: 'u', anonKey: 'k', license: LICENSE, branchId: id }
  const q = <T>(sql: string, ...a: unknown[]): T[] => sqlite.prepare(sql).all(...a) as T[]
  return {
    id, name, sqlite, bills, trash, outbox, sync, repo, applier, q, creds, billRepo,
    setClock: (ms: number): void => { clock = ms },
    advance: (ms: number): void => { clock += ms },
    pull: createPullWorker({ sync, repo, applier, credentials: () => creds, encryptionKey: () => KEY, makeTransport: () => mem, emit: () => undefined, log }),
    push: null as unknown as ReturnType<typeof createPushWorker>
  }
}
type Branch = ReturnType<typeof branch>

async function world(n: number) {
  const mem = new InMemoryTransport()
  mem.addLicense(LICENSE, { maxBranches: 10 })
  const bs = Array.from({ length: n }, (_, i) => branch(mem, String.fromCharCode(65 + i)))
  for (const b of bs) await mem.registerBranch({ license: LICENSE, branchId: b.id, name: b.name, poPrefix: `${b.name}${b.name}${b.name}-`, device: 'PC' })
  for (const b of bs) b.push = createPushWorker({ outbox: b.outbox.repo, bills: b.billRepo, credentials: () => b.creds, encryptionKey: () => KEY, recipients: () => bs.filter((x) => x !== b).map((x) => x.id), makeTransport: () => mem, log })
  return { mem, bs }
}
/** Pushes and pulls everywhere until nothing is moving (bounded). */
async function settle(w: Awaited<ReturnType<typeof world>>): Promise<void> {
  for (let round = 0; round < 8; round++) {
    for (const b of w.bs) await b.push.runOnce()
    for (const b of w.bs) await b.pull.runOnce()
    if (w.mem.postboxSize === 0 && w.bs.every((b) => b.outbox.repo.counts().pending === 0)) return
  }
}

const input = (id: string, qty: string): SaveBillInput => ({
  bill: { id, party: { name: 'Ruby Traders', phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-10', rows: [row('Pen', qty, '9'), blankRow()] }
})
const view = (b: Branch, id: string) => {
  const h = b.q<{ revision: number; updatedAt: string; deletedAt: string | null; syncState: string }>('SELECT revision, updated_at AS updatedAt, deleted_at AS deletedAt, sync_state AS syncState FROM bills WHERE id = ?', id)[0]
  if (!h) return undefined
  return { ...h, rows: b.q<{ name_plain: string; qty: string | null }>('SELECT name_plain, qty FROM bill_rows WHERE bill_id = ? ORDER BY idx', id).map((r) => `${r.name_plain}:${r.qty}`) }
}
const same = (v: ReturnType<typeof view>) => v && { revision: v.revision, updatedAt: v.updatedAt, deletedAt: v.deletedAt, rows: v.rows }

describe('conflicts (Phase 57)', () => {
  it('two branches edit the same bill offline: the later edit wins everywhere, the loser is kept in the audit log, the bill is marked conflict until dismissed', async () => {
    const w = await world(2)
    const [a, b] = w.bs as [Branch, Branch]
    a.setClock(BASE); a.bills.save(input(U('c1'), '10'))
    await settle(w)
    expect(view(b, U('c1'))?.rows[0]).toBe('Pen:10')
    a.setClock(BASE + 60_000); a.bills.save(input(U('c1'), '11'))   // A edits offline ...
    b.setClock(BASE + 120_000); b.bills.save(input(U('c1'), '22'))  // ... and B edits later, also offline
    await settle(w)
    for (const x of [a, b]) expect(same(view(x, U('c1')))).toEqual({ revision: 2, updatedAt: new Date(BASE + 120_000).toISOString(), deletedAt: null, rows: ['Pen:22'] })
    expect(view(b, U('c1'))?.syncState).toBe('synced')                 // B won: nothing to review
    expect(view(a, U('c1'))?.syncState).toBe('conflict')               // A lost an unsent edit
    const list = a.applier.conflicts()
    expect(list).toEqual([expect.objectContaining({ billId: U('c1'), lost: 'edit', loserRevision: 2, winnerBranch: b.id, winnerRevision: 2, winnerDeleted: false })])
    const audit = a.q<{ detail_json: string; action: string; entity_id: string }>("SELECT detail_json, action, entity_id FROM audit_log WHERE action = 'conflict'")
    expect(audit).toHaveLength(1)
    const detail = conflictDetailSchema.parse(JSON.parse(audit[0]!.detail_json))
    const snap = detail.snapshot as { bill: { revision: number }; rows: { qty: string }[] }
    expect(snap.rows.map((r) => r.qty)).toEqual(['11'])                // the lost edit is intact
    expect(b.applier.conflicts()).toEqual([])
    // Sending again does not clear it; the owner does.
    await a.push.runOnce()
    expect(view(a, U('c1'))?.syncState).toBe('conflict')
    expect(a.applier.dismissConflict(U('c1'))).toEqual({ done: true })
    expect(view(a, U('c1'))?.syncState).toBe('synced')
    expect(a.applier.dismissConflict(U('c1'))).toEqual({ done: false })
    expect(a.applier.conflicts()).toEqual([])
  })

  it('the losing branch never overwrites the winner: an older edit that arrives later is ignored silently (no conflict anywhere)', async () => {
    const w = await world(2)
    const [a, b] = w.bs as [Branch, Branch]
    a.setClock(BASE); a.bills.save(input(U('s1'), '10'))
    await settle(w)
    a.setClock(BASE + 60_000); a.bills.save(input(U('s1'), '11'))
    b.setClock(BASE + 120_000); b.bills.save(input(U('s1'), '22'))
    // B's (winning) edit reaches A first; A's older edit arrives at B afterwards.
    await b.push.runOnce(); await a.pull.runOnce()
    await a.push.runOnce(); await b.pull.runOnce()
    expect(view(b, U('s1'))?.rows[0]).toBe('Pen:22')
    expect(b.applier.conflicts()).toEqual([])
    expect(view(b, U('s1'))?.syncState).toBe('synced')
  })

  it('delete vs edit: the later one wins; a lost local delete is a conflict of kind delete (resurrection), a lost edit of kind edit', async () => {
    const w = await world(2)
    const [a, b] = w.bs as [Branch, Branch]
    a.setClock(BASE); a.bills.save(input(U('d1'), '10')); a.bills.save(input(U('d2'), '10'))
    await settle(w)
    // d1: A deletes, B edits LATER -> the edit wins, A's delete is lost.
    a.setClock(BASE + 60_000); a.bills.delete([U('d1')])
    b.setClock(BASE + 120_000); b.bills.save(input(U('d1'), '33'))
    // d2: A edits, B deletes LATER -> the delete wins, A's edit is lost.
    a.setClock(BASE + 60_000); a.bills.save(input(U('d2'), '44'))
    b.setClock(BASE + 120_000); b.bills.delete([U('d2')])
    await settle(w)
    for (const x of [a, b]) {
      expect(view(x, U('d1'))).toMatchObject({ deletedAt: null, rows: ['Pen:33'] })
      expect(view(x, U('d2'))?.deletedAt).not.toBeNull()
    }
    expect(a.applier.conflicts().map((c) => [c.billId, c.lost, c.winnerDeleted]).sort()).toEqual([[U('d1'), 'delete', false], [U('d2'), 'edit', true]].sort())
  })

  it('delete then restore (higher revision) resurrects the bill on every branch, even when the restore overtakes the delete', async () => {
    const w = await world(3)
    const [a, b, c] = w.bs as [Branch, Branch, Branch]
    a.setClock(BASE); a.bills.save(input(U('r1'), '10'))
    await settle(w)
    a.setClock(BASE + 60_000); a.bills.delete([U('r1')])
    await a.push.runOnce()
    a.setClock(BASE + 120_000); a.trash.restore([U('r1')])
    await a.push.runOnce() // both rows are in the postbox; the outbox kept only the newest per bill, so C sees the restore only
    await settle(w)
    for (const x of [a, b, c]) expect(view(x, U('r1'))).toMatchObject({ revision: 3, deletedAt: null, rows: ['Pen:10'] })
    // And the opposite order at the applier: restore first, tombstone later -> still live.
    const meta = (rev: number, at: string, deleted: boolean) => ({ fromBranch: a.id, billId: U('r1'), op: (deleted ? 'delete' : 'upsert') as 'delete' | 'upsert', revision: rev, updatedAt: at })
    const rec = c.repo.record(U('r1'))!
    const snap = (rev: number, at: string, deleted: boolean): RemoteSnapshot => ({ v: 1, bill: { ...rec, revision: rev, updatedAt: at, deletedAt: deleted ? at : null, syncState: undefined } as never, rows: c.repo.rows(U('r1')), deleted })
    const t2 = new Date(BASE + 60_000).toISOString()
    expect(c.repo.transaction(() => c.applier.apply(meta(2, t2, true), snap(2, t2, true), []))).toBe('ignored')
    expect(view(c, U('r1'))?.deletedAt).toBeNull()
  })

  it('the same version re-sent under another sender changes nothing (no churn, no conflict)', async () => {
    const w = await world(2)
    const [a, b] = w.bs as [Branch, Branch]
    a.setClock(BASE); a.bills.save(input(U('e1'), '10'))
    await settle(w)
    const before = view(b, U('e1'))
    const rec = a.repo.record(U('e1'))!
    const snap: RemoteSnapshot = { v: 1, bill: { ...rec, syncState: undefined } as never, rows: a.repo.rows(U('e1')), deleted: false }
    const out = b.repo.transaction(() => b.applier.apply({ fromBranch: 'zzzz-greater-branch', billId: U('e1'), op: 'upsert', revision: rec.revision, updatedAt: rec.updatedAt }, snap, [{ branchId: 'zzzz-greater-branch', name: 'Z', poPrefix: 'ZZZ-' }]))
    expect(out).toBe('ignored')
    expect(view(b, U('e1'))).toEqual(before)
  })

  it('sync:conflicts / sync:dismissConflict validate strictly', async () => {
    const w = await world(2)
    const a = w.bs[0] as Branch
    const h = syncHandlers(a.outbox, a.applier)
    expect(await h['sync:conflicts']!({})).toMatchObject({ ok: true, data: [] })
    expect(await h['sync:conflicts']!({ x: 1 })).toMatchObject({ ok: false })
    expect(await h['sync:dismissConflict']!({ billId: '' })).toMatchObject({ ok: false })
    expect(await h['sync:dismissConflict']!({ billId: U('none') })).toMatchObject({ ok: true, data: { done: false } })
  })
})

describe('convergence (Phase 57)', () => {
  it('property: ANY delivery order (with duplicates) of the same set of versions ends in the same state on every branch', () => {
    const origin = 'branch-origin'
    const authors = ['branch-a', 'branch-b', 'branch-c']
    const list = authors.map((id, i) => ({ branchId: id, name: id, poPrefix: `P${i}-` })).concat([{ branchId: origin, name: 'O', poPrefix: 'PO-' }])
    for (let seed = 1; seed <= 40; seed++) {
      const rand = rng(seed)
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T
      // Versions of ONE bill: random time (with ties), revision, author, deleted flag, content. Triples are unique so the order is total.
      const seen = new Set<string>()
      const versions: { at: string; rev: number; author: string; deleted: boolean; qty: string }[] = []
      for (let k = 0; k < 7; k++) {
        const v = { at: new Date(BASE + Math.floor(rand() * 4) * 1000).toISOString(), rev: 1 + Math.floor(rand() * 4), author: pick(authors), deleted: rand() < 0.3, qty: String(10 + k) }
        const key = `${v.at}|${v.rev}|${v.author}`
        if (!seen.has(key)) { seen.add(key); versions.push(v) }
      }
      const expected = versions.reduce((cur, v) => (incomingWins({ updatedAt: cur.at, revision: cur.rev, branchId: cur.author }, { updatedAt: v.at, revision: v.rev, branchId: v.author }) ? v : cur))
      const finals: unknown[] = []
      for (let r = 0; r < 4; r++) {
        const mem = new InMemoryTransport()
        const t = openTestDb(); dbs.push(t)
        const sqlite = t.handle.sqlite
        const repo = createRemoteApplyRepo(sqlite)
        const sync = createSyncStateRepo(sqlite)
        const applier = createRemoteApplier({ repo, sync, localBranchId: () => getLocalBranch(sqlite).id, log, emit: () => undefined })
        void mem
        const order = [...versions, ...versions.slice(0, 3)] // some duplicates
        for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!] }
        for (const v of order) {
          const bill = {
            id: U('prop'), branchId: origin, poSeq: 1, poNumber: 'PO-0001', partyId: null, partySnapshotJson: '{"name":"R","phone":"","address":"","transport":""}', formatId: 'non_gst',
            extraColsJson: '[]', paperOverride: null, billDate: '2026-10-10', totalsJson: '{}', itemRowCount: 1, revision: v.rev, createdAt: new Date(BASE).toISOString(), updatedAt: v.at, deletedAt: v.deleted ? v.at : null
          }
          const rows = [{ id: `${U('prop')}-r${v.qty}`, billId: U('prop'), idx: 0, nameRunsJson: '[]', namePlain: 'Pen', qty: v.qty, rate: '9', totalOverride: null, gstRate: null, extrasJson: '{}', cellStyleJson: null }]
          repo.transaction(() => applier.apply({ fromBranch: v.author, billId: U('prop'), op: v.deleted ? 'delete' : 'upsert', revision: v.rev, updatedAt: v.at }, { v: 1, bill, rows, deleted: v.deleted } as RemoteSnapshot, list))
        }
        const h = sqlite.prepare('SELECT revision, updated_at AS u, deleted_at AS d FROM bills WHERE id = ?').get(U('prop')) as { revision: number; u: string; d: string | null }
        const qty = (sqlite.prepare('SELECT qty FROM bill_rows WHERE bill_id = ?').get(U('prop')) as { qty: string }).qty
        const author = (sqlite.prepare('SELECT saved_by_branch AS a FROM bill_revisions WHERE bill_id = ? AND revision = ?').get(U('prop'), h.revision) as { a: string }).a
        finals.push({ ...h, qty, author })
        expect(h).toMatchObject({ revision: expected.rev, u: expected.at, d: expected.deleted ? expected.at : null })
        expect(qty).toBe(expected.qty)
        expect(author).toBe(expected.author)
      }
      expect(new Set(finals.map((f) => JSON.stringify(f))).size).toBe(1)
    }
  })

  it('property: three branches doing random saves / deletes / restores with random partial syncs end up with identical bills', async () => {
    for (let seed = 1; seed <= 25; seed++) {
      const rand = rng(1000 + seed)
      const w = await world(3)
      let t = BASE
      const known = (b: Branch): string[] => b.q<{ id: string }>('SELECT id FROM bills').map((r) => r.id)
      const created: string[] = []
      for (let step = 0; step < 14; step++) {
        const b = w.bs[Math.floor(rand() * 3)] as Branch
        t += 1000 + Math.floor(rand() * 4000)
        b.setClock(t)
        const mine = known(b)
        const r = rand()
        try {
          if (mine.length === 0 || r < 0.25) { const id = randomUUID(); created.push(id); b.bills.save(input(id, String(1 + Math.floor(rand() * 90)))) }
          else if (r < 0.65) b.bills.save(input(mine[Math.floor(rand() * mine.length)]!, String(1 + Math.floor(rand() * 90))))
          else if (r < 0.85) b.bills.delete([mine[Math.floor(rand() * mine.length)]!])
          else b.trash.restore([mine[Math.floor(rand() * mine.length)]!])
        } catch { /* e.g. saving a deleted bill is refused: just skip */ }
        if (rand() < 0.4) { const x = w.bs[Math.floor(rand() * 3)] as Branch; await (rand() < 0.5 ? x.push.runOnce() : x.pull.runOnce()) }
      }
      await settle(w)
      const snapshot = (b: Branch) => known(b).sort().map((id) => [id, same(view(b, id))])
      const first = JSON.stringify(snapshot(w.bs[0] as Branch))
      for (const b of w.bs.slice(1)) expect(JSON.stringify(snapshot(b)), `seed ${seed}`).toBe(first)
      for (const b of w.bs) expect(b.sqlite.prepare("SELECT count(*) AS c FROM sync_outbox WHERE state = 'failed'").get()).toEqual({ c: 0 })
      for (const x of w.bs) x.sqlite.close()
      dbs.length = 0
    }
  })
})
