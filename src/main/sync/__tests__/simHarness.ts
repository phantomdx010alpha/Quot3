import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createItemRulesRepo } from '../../db/itemRulesRepo'
import { createOutboxRepo } from '../../db/outboxRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createRemoteApplyRepo } from '../../db/remoteApplyRepo'
import { createSyncStateRepo } from '../../db/syncStateRepo'
import { createTrashRepo } from '../../db/trashRepo'
import { getLocalBranch } from '../../db/seed'
import { createBillService, type SaveBillInput } from '../../services/billService'
import { createTrashService } from '../../services/trashService'
import { ITEM_RULE_REVISION } from '../../../shared/sync/itemRule'
import { createItemRuleApplier } from '../itemRuleApplier'
import { createOutbox } from '../outbox'
import { createPullWorker } from '../pullWorker'
import { createPushWorker } from '../pushWorker'
import { createRemoteApplier } from '../remoteApplier'
import { FlakyTransport } from '../flakyTransport'
import { InMemoryTransport } from '../transport'
import { blankRow, row } from '../../../shared/__fixtures__/bills'

/**
 * Phase 60 dev harness: N virtual branches (each a real temp SQLite + the real bill / trash services, outbox, push worker,
 * pull worker and applier) talking through one `InMemoryTransport` wrapped per branch in a `FlakyTransport`.
 * Everything runs in one process with a virtual clock per branch (so clock skew is just a different offset).
 */
export const HARNESS_LICENSE = 'Q3-ABCD-EFGH-JKLM'
export const HARNESS_BASE = Date.UTC(2026, 9, 10, 10, 0, 0)
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined }

/** Small seeded PRNG so a failing seed replays exactly. */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export interface HarnessOptions {
  branches?: number
  seed?: number
  dropBefore?: number
  dropAfter?: number
  maxDelayMs?: number
  /** Limit loss to these calls (see FlakyOptions.only). */
  only?: string[]
  /** Per-branch clock offset in ms (index = branch), to model skew. */
  skewMs?: number[]
  /** Phase 111: indexes of branches that do NOT know the `item_rule` kind (they acknowledge and ignore it). */
  legacyBranches?: number[]
}

export type SimBranch = ReturnType<typeof makeBranch>

function makeBranch(mem: InMemoryTransport, flaky: FlakyTransport, name: string, key: Buffer, dbs: TestDb[], offset: number, legacy = false) {
  const t = openTestDb(); dbs.push(t)
  const sqlite = t.handle.sqlite
  const id = getLocalBranch(sqlite).id
  let clock = HARNESS_BASE
  const now = (): Date => new Date(clock + offset)
  const outbox = createOutbox({ repo: createOutboxRepo(sqlite), capturing: () => true }, { now })
  const capture = (i: { billId: string; revision: number; op?: 'upsert' | 'delete' }): void => outbox.capture({ billId: i.billId, revision: i.revision, op: i.op ?? 'upsert' })
  /** Phase 111: owner rules; a local change is captured in the same transaction (like the app's wiring in main/index.ts). */
  const rules = createItemRulesRepo(sqlite, { onChange: (r) => outbox.capture({ billId: r.id, revision: ITEM_RULE_REVISION, op: r.deletedAt ? 'delete' : 'upsert' }) })
  const billRepo = createBillRepo(sqlite)
  const bills = createBillService({ sqlite, bills: billRepo, parties: createPartyRepo(sqlite) }, { now, newId: () => randomUUID(), outbox: capture })
  const trash = createTrashService({ repo: createTrashRepo(sqlite), branchId: () => id }, { now, outbox: capture })
  const sync = createSyncStateRepo(sqlite)
  const repo = createRemoteApplyRepo(sqlite)
  const applier = createRemoteApplier({ repo, sync, localBranchId: () => id, log: silent, emit: () => undefined }, { now })
  const creds = { url: 'u', anonKey: 'k', license: HARNESS_LICENSE, branchId: id }
  const q = <T>(sql: string, ...a: unknown[]): T[] => sqlite.prepare(sql).all(...a) as T[]
  return {
    id, name, sqlite, bills, trash, outbox, sync, repo, applier, q, creds, billRepo, key, flaky, rules,
    /** A rule decision as the page will make it: this branch's clock, this branch's id. */
    decide: (input: Parameters<typeof rules.save>[0]) => rules.save(input, { at: now().toISOString(), branchId: id }),
    setClock: (ms: number): void => { clock = ms },
    pull: createPullWorker({ sync, repo, applier, ...(legacy ? {} : { itemRules: createItemRuleApplier({ rules, localBranchId: () => id, log: silent }, { now }) }), credentials: () => creds, encryptionKey: () => key, makeTransport: () => flaky, emit: () => undefined, log: silent }),
    push: null as unknown as ReturnType<typeof createPushWorker>
  }
}

export async function createHarness(o: HarnessOptions = {}) {
  const dbs: TestDb[] = []
  const rand = rng(o.seed ?? 1)
  const key = randomBytes(32)
  const mem = new InMemoryTransport()
  mem.addLicense(HARNESS_LICENSE, { maxBranches: 10 })
  let down = false
  const n = o.branches ?? 2
  const flakies = Array.from({ length: n }, () => new FlakyTransport(mem, { rand, dropBefore: o.dropBefore, dropAfter: o.dropAfter, maxDelayMs: o.maxDelayMs, only: o.only, down: () => down }))
  const bs = Array.from({ length: n }, (_, i) => makeBranch(mem, flakies[i]!, String.fromCharCode(65 + i), key, dbs, o.skewMs?.[i] ?? 0, o.legacyBranches?.includes(i) ?? false))
  for (const b of bs) await mem.registerBranch({ license: HARNESS_LICENSE, branchId: b.id, name: b.name, poPrefix: `${b.name}${b.name}${b.name}-`, device: 'PC' })
  for (const b of bs) b.push = createPushWorker({ outbox: b.outbox.repo, bills: b.billRepo, itemRules: b.rules, credentials: () => b.creds, encryptionKey: () => key, recipients: () => bs.filter((x) => x !== b).map((x) => x.id), makeTransport: () => b.flaky, log: silent })
  const h = {
    mem, bs, rand,
    setDown: (v: boolean): void => { down = v },
    /** Turns all loss and delay off (the "network is fine again" moment). */
    heal: (): void => { down = false; for (const f of flakies) { f.dropBefore = 0; f.dropAfter = 0; f.maxDelayMs = 0 } },
    /** Pushes and pulls everywhere until nothing is moving; returns the rounds used (-1 = did not settle). */
    async settle(maxRounds = 12): Promise<number> {
      for (let round = 1; round <= maxRounds; round++) {
        for (const b of bs) await b.push.runOnce()
        for (const b of bs) await b.pull.runOnce()
        if (mem.postboxSize === 0 && bs.every((b) => b.outbox.repo.counts().pending === 0)) return round
      }
      return -1
    },
    metrics() {
      const total = flakies.map((f) => f.metrics)
      return total
    },
    close(): void { for (const b of bs) { try { b.sqlite.close() } catch { /* already closed */ } } dbs.length = 0 }
  }
  return h
}
export type Harness = Awaited<ReturnType<typeof createHarness>>

export const U = (name: string): string => `00000000-0000-4000-8000-${createHash('sha1').update(name).digest('hex').slice(0, 12)}`
export const billInput = (id: string, qty: string): SaveBillInput => ({
  bill: { id, party: { name: 'Ruby Traders', phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-10', rows: [row('Pen', qty, '9'), blankRow()] }
})

/** The part of a bill that must be identical on every branch once all changes are delivered. */
export function billState(b: SimBranch, id: string) {
  const h = b.q<{ revision: number; updatedAt: string; deletedAt: string | null }>('SELECT revision, updated_at AS updatedAt, deleted_at AS deletedAt FROM bills WHERE id = ?', id)[0]
  if (!h) return null
  return { ...h, rows: b.q<{ name_plain: string; qty: string | null }>('SELECT name_plain, qty FROM bill_rows WHERE bill_id = ? ORDER BY idx', id).map((r) => `${r.name_plain}:${r.qty}`) }
}
export const allBillIds = (b: SimBranch): string[] => b.q<{ id: string }>('SELECT id FROM bills ORDER BY id').map((r) => r.id)
