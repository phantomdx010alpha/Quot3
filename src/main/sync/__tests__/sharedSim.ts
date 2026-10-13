import { createHash, randomUUID } from 'node:crypto'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createItemRulesRepo } from '../../db/itemRulesRepo'
import { createOutboxRepo } from '../../db/outboxRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createRemoteApplyRepo } from '../../db/remoteApplyRepo'
import { createSyncRecordRepo } from '../../db/syncRecordRepo'
import { createSyncStateRepo } from '../../db/syncStateRepo'
import { createTrashRepo } from '../../db/trashRepo'
import { getLocalBranch } from '../../db/seed'
import { createBillService, type SaveBillInput } from '../../services/billService'
import { createTrashService } from '../../services/trashService'
import { ITEM_RULE_REVISION } from '../../../shared/sync/itemRule'
import { blankRow, row } from '../../../shared/__fixtures__/bills'
import { createAsideService } from '../asideService'
import { createAsideApply, createHeldService, type HeldService } from '../heldService'
import { createLocalCompareSources } from '../billRecordV2'
import { createCompareService } from '../compareService'
import { createOutbox } from '../outbox'
import { createPullWorkerV2, type PullWorkerV2Deps, type PullWorkerV2Options } from '../pullWorkerV2'
import { createPushWorkerV2 } from '../pushWorkerV2'
import { createCustomerService } from '../../services/customerService'
import { createCustomerRepo } from '../../db/customerRepo'
import { partyRecordId } from '../../../shared/customers/duplicates'
import { createRecordApplierV2, type RecordApplierV2 } from '../recordApplierV2'
import { InMemorySharedServer, InMemorySharedTransport, type SharedBranch, type SharedStoreTransport } from '../sharedTransport'

/**
 * Phase 135 test harness: N virtual branches, each a real temp SQLite with the real bill / trash services, outbox, record repos, the v2
 * push worker, pull worker, applier and compare service, all talking to ONE `InMemorySharedServer` (the SQL rules of file 15 in memory).
 * One virtual clock `T` (server time); a branch's own clock is `T + skew`.
 */
export const SIM_KEY = 'Q3-ABCD-EFGH-JKLM'
export const SIM_BASE = Date.UTC(2026, 9, 12, 10, 0, 0)
export const silent = { info: () => undefined, warn: () => undefined, error: () => undefined }

export interface SimOptions { branches?: number; skewMs?: number[]; isOpen?: (branchIndex: number, billId: string) => boolean
  /** Phase 137: customers and merges travel (deterministic customer ids, party sources in the compare). Off by default so the older suites keep their counts. */
  parties?: boolean
  /** Phase 138: options for each branch's pull worker (poll interval, fake timers). */
  pullOpts?: PullWorkerV2Options
  /** Phase 141: wraps each branch's transport (e.g. in a `FlakySharedTransport`). Sign-in and activation happen on the plain transport first. */
  wrapTransport?: (t: SharedStoreTransport, branchIndex: number) => SharedStoreTransport }

export async function createSim(o: SimOptions = {}) {
  const dbs: TestDb[] = []
  const clock = { t: SIM_BASE }
  const server = new InMemorySharedServer({ now: () => clock.t })
  const n = o.branches ?? 2
  const { orgId } = server.addOrg({ licenseKey: SIM_KEY, seats: Array.from({ length: n }, (_, i) => ({ email: `seat${i + 1}@example.com`, password: `pw${i + 1}` })) })
  const prefixes = ['AA', 'BB', 'CC', 'DD']
  const bs: SimBranchV2[] = []
  for (let i = 0; i < n; i++) bs.push(await makeBranch(i))

  async function makeBranch(i: number) {
    const t = openTestDb(); dbs.push(t)
    const sqlite = t.handle.sqlite
    const id = getLocalBranch(sqlite).id
    const skew = o.skewMs?.[i] ?? 0
    const now = (): Date => new Date(clock.t + skew)
    const transport: SharedStoreTransport = new InMemorySharedTransport(server)
    await transport.signIn({ email: `seat${i + 1}@example.com`, password: `pw${i + 1}` })
    await transport.activate({ license: SIM_KEY, branchId: id, name: `Branch ${prefixes[i]}`, poPrefix: prefixes[i]!, device: 'PC', takeover: false })
    const wrapped = { current: o.wrapTransport ? o.wrapTransport(transport, i) : transport }
    const connect = async () => ({ transport: wrapped.current, creds: { license: SIM_KEY, branchId: id } })

    const outboxRepo = createOutboxRepo(sqlite)
    const outbox = createOutbox({ repo: outboxRepo, capturing: () => true }, { now })
    const capture = (c: { billId: string; revision: number; op?: 'upsert' | 'delete' }): void => outbox.capture({ billId: c.billId, revision: c.revision, op: c.op ?? 'upsert' })
    const rules = createItemRulesRepo(sqlite, { onChange: (r) => outbox.capture({ billId: r.id, revision: ITEM_RULE_REVISION, op: r.deletedAt ? 'delete' : 'upsert' }) })
    const billRepo = createBillRepo(sqlite)
    const partyRepo = createPartyRepo(sqlite)
    const emitIds = (ids: readonly string[]): void => { if (!o.parties) return; for (const rid of ids) outbox.capture({ billId: rid, revision: 0, op: 'upsert' }) }
    const newPartyId = (norm: string): string => partyRecordId(orgId, norm)
    const partySrc = o.parties ? partyRepo : undefined
    const bills = createBillService({ sqlite, bills: billRepo, parties: partyRepo }, { now, newId: () => randomUUID(), outbox: capture, ...(o.parties ? { newPartyId, partyCreated: (pid: string) => emitIds([pid]) } : {}) })
    const customers = createCustomerService({ parties: partyRepo, customers: createCustomerRepo(sqlite), branchId: () => id, ...(o.parties ? { newPartyId } : {}), emit: emitIds }, { now, newId: () => randomUUID() })
    const trash = createTrashService({ repo: createTrashRepo(sqlite), branchId: () => id }, { now, outbox: capture })
    const sync = createSyncStateRepo(sqlite)
    const records = createSyncRecordRepo(sqlite)
    const repo = createRemoteApplyRepo(sqlite)
    let known: readonly SharedBranch[] = []
    const held: { current: HeldService } = { current: null as unknown as HeldService }
    const baseApplier = createRecordApplierV2({
      repo, bills: billRepo, outbox: outboxRepo, itemRules: rules, localBranchId: () => id, branches: () => known, isAside: (k, r) => records.isAside(k, r), isOpen: (b) => (o.isOpen ? o.isOpen(i, b) : false) || held.current.isOpen(b),
      rememberBase: (kind, recId, version, hash, serverSeq) => records.putState({ kind, recId, baseVersion: version, baseHash: hash, serverSeq, syncedAt: now().toISOString() }),
      log: silent
    }, { now, newId: () => randomUUID() })
    const applier: { current: RecordApplierV2 } = { current: baseApplier }
    held.current = createHeldService({ records, sync, applier: baseApplier, offsetMs: () => null, now })
    let readerVer = 1
    const aside = createAsideService({ repo: records, now, readerVer: () => readerVer, apply: createAsideApply({ applier: baseApplier, records, offsetMs: () => null, now }) })
    const push = createPushWorkerV2({ outbox: outboxRepo, bills: billRepo, revisions: repo, itemRules: rules, parties: partySrc, records, sync, connect, appVer: '1.0.0', newId: () => randomUUID(), log: silent }, { now })
    const pullDeps: PullWorkerV2Deps = { records, sync, aside, applier: { apply: (r, c) => applier.current.apply(r, c) }, connect, setBranches: (l) => { known = l }, log: silent }
    const pull = createPullWorkerV2(pullDeps, { now, ...(o.pullOpts ?? {}) })
    const compare = createCompareService({
      records, sync, connect, log: silent, now,
      sources: createLocalCompareSources({ bills: billRepo, heads: () => repo.heads(), outbox: outboxRepo, itemRules: rules, parties: partySrc, appVer: '1.0.0', now })
    })
    const q = <T>(sql: string, ...a: unknown[]): T[] => sqlite.prepare(sql).all(...a) as T[]
    return {
      index: i, partyRepo, customers, held, setReaderVer: (n: number): void => { readerVer = n }, id, sqlite, bills, trash, rules, outbox, outboxRepo, sync, records, repo, billRepo, aside, push, pull, compare, q, wrapped, applier, transport,
      decide: (input: Parameters<typeof rules.save>[0]) => rules.save(input, { at: now().toISOString(), branchId: id }),
      rows: (billId: string): string[] => q<{ name_plain: string; qty: string | null }>('SELECT name_plain, qty FROM bill_rows WHERE bill_id = ? ORDER BY idx', billId).map((r) => `${r.name_plain}:${r.qty}`),
      bill: (billId: string) => q<{ revision: number; deletedAt: string | null; syncState: string }>('SELECT revision, deleted_at AS deletedAt, sync_state AS syncState FROM bills WHERE id = ?', billId)[0],
      revisions: (billId: string) => q<{ revision: number; snapshotJson: string }>('SELECT revision, snapshot_json AS snapshotJson FROM bill_revisions WHERE bill_id = ? ORDER BY revision', billId),
      pendingCount: (): number => outboxRepo.counts().pending
    }
  }
  type SimBranchV2 = Awaited<ReturnType<typeof makeBranch>>

  return {
    server, orgId, bs, clock,
    /** Moves the virtual clock forward (all branches follow). */
    tick: (ms: number): void => { clock.t += ms },
    /** Pushes then pulls on every branch, a few rounds, until nothing is waiting. */
    async settle(rounds = 6): Promise<void> {
      for (let i = 0; i < rounds; i++) {
        for (const b of bs) await b.push.runOnce()
        for (const b of bs) await b.pull.runOnce()
      }
    },
    close(): void { for (const t of dbs.splice(0)) { try { t.cleanup() } catch { /* already closed */ } } }
  }
}
export type Sim = Awaited<ReturnType<typeof createSim>>
export type SimBranchV2 = Sim['bs'][number]

export const U = (name: string): string => {
  return `00000000-0000-4000-8000-${createHash('sha1').update(name).digest('hex').slice(0, 12)}`
}
export const billInput = (id: string, qty: string, over: { name?: string; item?: string; expectedRevision?: number } = {}): SaveBillInput => ({
  bill: { id, party: { name: over.name ?? 'Ruby Traders', phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-10', rows: [row(over.item ?? 'Pen', qty, '9'), blankRow()] },
  ...(over.expectedRevision !== undefined ? { expectedRevision: over.expectedRevision } : {})
})
