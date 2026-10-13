import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createLegacyImportRepo } from '../../db/legacyImportRepo'
import { createOutboxRepo } from '../../db/outboxRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createRemoteApplyRepo } from '../../db/remoteApplyRepo'
import { createSyncStateRepo } from '../../db/syncStateRepo'
import { getLocalBranch } from '../../db/seed'
import { createBillService } from '../../services/billService'
import { createLegacyImportService } from '../../services/legacyImportService'
import { createOutbox } from '../outbox'
import { createPullWorker } from '../pullWorker'
import { createPushWorker } from '../pushWorker'
import { createRemoteApplier } from '../remoteApplier'
import { InMemoryTransport } from '../transport'

const LICENSE = 'Q3-ABCD-EFGH-JKLM'
const KEY = randomBytes(32)
const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const dbs: TestDb[] = []
const dirs: string[] = []
afterEach(() => { dbs.splice(0).forEach((t) => t.cleanup()); dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })) })
const BASE = Date.parse('2026-10-10T10:00:00.000Z')

function branch(mem: InMemoryTransport, name: string, capturing = true) {
  const t = openTestDb(); dbs.push(t)
  const sqlite = t.handle.sqlite
  const id = getLocalBranch(sqlite).id
  const now = (): Date => new Date(BASE)
  const outbox = createOutbox({ repo: createOutboxRepo(sqlite), capturing: () => capturing }, { now })
  const billRepo = createBillRepo(sqlite)
  const partyRepo = createPartyRepo(sqlite)
  const sync = createSyncStateRepo(sqlite)
  const repo = createRemoteApplyRepo(sqlite)
  const applier = createRemoteApplier({ repo, sync, localBranchId: () => id, log, emit: () => undefined }, { now })
  const creds = { url: 'u', anonKey: 'k', license: LICENSE, branchId: id }
  const importer = createLegacyImportService(
    { sqlite, repo: createLegacyImportRepo(sqlite), bills: billRepo, backup: { create: async (kind) => ({ file: 'x.db', kind, createdAt: new Date(BASE).toISOString(), sizeBytes: 1, billCount: 0, readable: true }) }, log },
    { now, newId: () => randomUUID(), outboxMany: (l) => outbox.captureMany(l) }
  )
  const bills = createBillService({ sqlite, bills: billRepo, parties: partyRepo }, { now, newId: () => randomUUID(), outbox: (i) => outbox.capture({ billId: i.billId, revision: i.revision, op: i.op ?? 'upsert' }) })
  return {
    id, name, sqlite, outbox, billRepo, applier, creds, importer, bills,
    q: <T>(sql: string, ...a: unknown[]): T[] => sqlite.prepare(sql).all(...a) as T[],
    pull: createPullWorker({ sync, repo, applier, credentials: () => creds, encryptionKey: () => KEY, makeTransport: () => mem, emit: () => undefined, log }),
    push: null as unknown as ReturnType<typeof createPushWorker>
  }
}
type Branch = ReturnType<typeof branch>

async function world() {
  const mem = new InMemoryTransport()
  mem.addLicense(LICENSE, { maxBranches: 10 })
  const bs = [branch(mem, 'A'), branch(mem, 'B')] as [Branch, Branch]
  for (const b of bs) await mem.registerBranch({ license: LICENSE, branchId: b.id, name: b.name, poPrefix: `${b.name}${b.name}${b.name}-`, device: 'PC' })
  for (const b of bs) b.push = createPushWorker({ outbox: b.outbox.repo, bills: b.billRepo, credentials: () => b.creds, encryptionKey: () => KEY, recipients: () => bs.filter((x) => x !== b).map((x) => x.id), makeTransport: () => mem, log })
  return bs
}
function folderOf(n: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'quot3-legacy-')); dirs.push(dir)
  for (let i = 1; i <= n; i++) {
    writeFileSync(join(dir, `b${i}.json`), JSON.stringify({
      bill_no: i, date: '08-10-2026', party: `PARTY ${i % 40}`, phone: '', transport: '', gst: '', format_mode: 'manual', extra_headers: [],
      items: [{ name: `Item ${i}`, qty: '2', rate: '10', amt: '20' }], total: 20
    }))
  }
  return dir
}
const src = (dir: string) => ({ kind: 'folder' as const, path: dir })
const drain = async (bs: Branch[]): Promise<void> => { for (let i = 0; i < 40; i++) { for (const b of bs) await b.push.runOnce(); for (const b of bs) await b.pull.runOnce(); if (bs[0]!.outbox.repo.counts().pending === 0 && bs[1]!.q<{ n: number }>('SELECT count(*) AS n FROM bills')[0]!.n > 0 && i > 1) break } }

describe('import -> outbox -> other branch (Phase 88)', () => {
  it('a 1000-bill import is enqueued in bulk, arrives complete on the other branch, and a duplicate delivery is ignored', async () => {
    const [a, b] = await world()
    const res = await a.importer.commit(src(folderOf(1000)))
    expect(res.batchId).not.toBeNull()
    expect(a.outbox.repo.counts().pending).toBe(1000)
    expect(a.q('SELECT 1 FROM bills WHERE sync_state = ?', 'pending')).toHaveLength(1000)
    await drain([a, b])
    expect(a.outbox.repo.counts().pending).toBe(0)
    expect(b.q<{ n: number }>('SELECT count(*) AS n FROM bills')[0]!.n).toBe(1000)
    const tagged = b.q<{ n: number }>('SELECT count(*) AS n FROM bills WHERE legacy_ref IS NOT NULL AND import_fingerprint IS NOT NULL AND import_batch_id IS NOT NULL')[0]!.n
    expect(tagged).toBe(1000)
    expect(b.q<{ n: number }>('SELECT count(*) AS n FROM parties WHERE source = ?', 'sync')[0]!.n).toBe(40)
    expect(b.q('SELECT 1 FROM sync_outbox')).toHaveLength(0)

    // duplicate delivery of one bill, and the same file under another bill id: both ignored
    const id = a.q<{ id: string }>('SELECT id FROM bills ORDER BY po_seq LIMIT 1')[0]!.id
    const { syncState: _s, ...bill } = a.billRepo.getRecord(id) as Record<string, unknown> & { syncState: string; revision: number; updatedAt: string }
    void _s
    const rows = a.billRepo.getRows(id) as never[]
    const meta = { fromBranch: a.id, billId: id, op: 'upsert' as const, revision: bill.revision, updatedAt: bill.updatedAt }
    const branches = [{ branchId: a.id, name: 'A', poPrefix: 'AAA-' }]
    expect(b.applier.apply(meta, { v: 1, bill, rows, deleted: false } as never, branches as never)).toBe('ignored')
    const other = randomUUID()
    expect(b.applier.apply({ ...meta, billId: other }, { v: 1, bill: { ...bill, id: other }, rows: rows.map((r: { billId: string }) => ({ ...r, billId: other })), deleted: false } as never, branches as never)).toBe('ignored')
    expect(b.q<{ n: number }>('SELECT count(*) AS n FROM bills')[0]!.n).toBe(1000)
  }, 240_000)

  it('with "send" off nothing is queued and bills stay local_only', async () => {
    const [a] = await world()
    await a.importer.commit(src(folderOf(20)), undefined, undefined, false)
    expect(a.outbox.repo.counts().pending).toBe(0)
    expect(a.q('SELECT 1 FROM bills WHERE sync_state = ?', 'local_only')).toHaveLength(20)
  })

  it('with sync off (not capturing) the import still works and queues nothing', async () => {
    const mem = new InMemoryTransport()
    const a = branch(mem, 'A', false)
    await a.importer.commit(src(folderOf(5)))
    expect(a.q('SELECT 1 FROM bills')).toHaveLength(5)
    expect(a.q('SELECT 1 FROM sync_outbox')).toHaveLength(0)
  })
})
