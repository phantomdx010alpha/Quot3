import { FlakySharedTransport, type SharedMetrics } from '../flakyTransport'
import { createSim, billInput, U, SIM_BASE, type Sim, type SimBranchV2 } from './sharedSim'

/**
 * Phase 141 harness v2: N virtual branches (2 to 4), each a real temp SQLite with the real bill / trash services, outbox, v2 push / pull
 * workers, applier and compare service (`createSim`), talking to ONE `InMemorySharedServer` THROUGH a `FlakySharedTransport` per branch
 * (loss before the server, loss of the answer, duplicate delivery, whole-network-down, virtual delays). Everything is driven by two seeded
 * generators (one for the edits, one for the network), so a failing seed replays exactly. No real timers; a thousand operations take seconds.
 *
 * Content only: no bill text is logged, failures print the seed and counts.
 *
 * WINDOWS FLAKE NOTE (soak): the soak uses the fixed seed `SOAK_SEED`. Its only environment-dependent cost is SQLite fsync time on a slow
 * Windows disk, which can push the run past a tight vitest timeout; it never changes the outcome (nothing in the run reads the real clock or the
 * real network: time is the virtual clock). A red soak on Windows is therefore a TIMEOUT first: rerun with a larger `--testTimeout`, and only
 * if the snapshots differ treat it as a real bug and keep the printed seed.
 */
export const SOAK_SEED = 20261013

/** Small seeded PRNG (mulberry32), returns [0, 1). */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export interface Loss { dropBefore?: number; dropAfter?: number; duplicate?: number; maxDelayMs?: number }
export interface HarnessV2Options {
  seed: number
  branches?: 2 | 3 | 4
  skewMs?: number[]
  parties?: boolean
  loss?: Loss
  /** How many different bills the random edits touch (small = many conflicts). Default 12. */
  billPool?: number
}

export type OpKind = 'edit' | 'delete' | 'restore' | 'push' | 'pull' | 'netflip'

export async function createHarnessV2(o: HarnessV2Options) {
  const rand = rng(o.seed)
  const netRand = rng(o.seed ^ 0x9e3779b9)
  const net = { down: false }
  const flaky: FlakySharedTransport[] = []
  const sim: Sim = await createSim({
    branches: o.branches ?? 3, ...(o.skewMs ? { skewMs: o.skewMs } : {}), parties: o.parties ?? false,
    wrapTransport: (t) => { const f = new FlakySharedTransport(t, { rand: netRand, ...(o.loss ?? {}), down: () => net.down }); flaky.push(f); return f }
  })
  const pool = Array.from({ length: o.billPool ?? 12 }, (_, i) => U(`pool-${o.seed}-${i}`))
  const names = ['Ruby Traders', 'Alpha Stores', 'Delta Mart']
  const counts: Record<OpKind, number> = { edit: 0, delete: 0, restore: 0, push: 0, pull: 0, netflip: 0 }
  let qtySeq = 0
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T
  const state = (b: SimBranchV2, id: string): 'none' | 'live' | 'trashed' => { const r = b.bill(id); return !r ? 'none' : r.deletedAt ? 'trashed' : 'live' }

  /** One random operation on a random branch (or on the network). The virtual clock moves 0..3 s first, so ties and near-ties both happen. */
  async function step(): Promise<OpKind> {
    sim.tick(Math.floor(rand() * 3000))
    const b = pick(sim.bs)
    const w = rand() * 100
    let kind: OpKind
    if (w < 42) {
      kind = 'edit'
      const id = pick(pool)
      if (state(b, id) === 'trashed') b.trash.restore([id])
      b.bills.save(billInput(id, String(++qtySeq), { item: `I${qtySeq % 9}`, name: pick(names) }))
    } else if (w < 52) {
      kind = 'delete'
      const id = pick(pool)
      if (state(b, id) === 'live') b.bills.delete([id])
    } else if (w < 60) {
      kind = 'restore'
      const id = pick(pool)
      if (state(b, id) === 'trashed') b.trash.restore([id])
    } else if (w < 76) { kind = 'push'; await b.push.runOnce() }
    else if (w < 92) { kind = 'pull'; await b.pull.runOnce() }
    else { kind = 'netflip'; net.down = !net.down }
    counts[kind]++
    return kind
  }

  /** Ends all loss, brings the network up, jumps over any back-off, then syncs everyone until nothing is waiting. */
  async function converge(): Promise<void> {
    net.down = false
    for (const f of flaky) f.heal()
    sim.tick(15 * 60 * 1000)
    for (let round = 0; round < 6; round++) {
      await sim.settle(4)
      if (sim.bs.every((b) => b.pendingCount() === 0)) break
      sim.tick(60 * 1000)
    }
  }

  return {
    sim, flaky, pool, counts, rand, net, state,
    async run(n: number): Promise<void> { for (let i = 0; i < n; i++) await step() },
    step, converge,
    metrics(): SharedMetrics { return flaky.reduce((m, f) => { const x = f.metrics; m.calls += x.calls; m.dropsBefore += x.dropsBefore; m.dropsAfter += x.dropsAfter; m.duplicates += x.duplicates; m.downRefusals += x.downRefusals; m.virtualDelayMs += x.virtualDelayMs; for (const [k, v] of Object.entries(x.byFn)) m.byFn[k] = (m.byFn[k] ?? 0) + v; return m }, { calls: 0, dropsBefore: 0, dropsAfter: 0, duplicates: 0, downRefusals: 0, virtualDelayMs: 0, byFn: {} as Record<string, number> }) },
    close: (): void => sim.close()
  }
}
export type HarnessV2 = Awaited<ReturnType<typeof createHarnessV2>>

/** Everything a person could see, without local-only numbers (revision, sync_state): bills with rows, deleted flag and customer, plus live customers. */
export function snapshotOf(b: SimBranchV2, partyIds = false): string {
  const bills = b.q<{ id: string; del: number; date: string; party: string | null }>('SELECT bl.id AS id, (bl.deleted_at IS NOT NULL) AS del, bl.bill_date AS date, p.name AS party FROM bills bl LEFT JOIN parties p ON p.id = bl.party_id ORDER BY bl.id')
    .map((r) => `${r.id}|${r.del}|${r.date}|${r.del ? '' : (r.party ?? '')}|${b.rows(r.id).join(',')}`) // a trashed bill's customer link is per computer by design (recordApplierV2 links only live bills)
  // without customer sync (parties off) each computer makes its own customer ids, so only the names are comparable
  const parties = b.q<{ id: string; name: string }>('SELECT id, name FROM parties WHERE deleted_at IS NULL ORDER BY name, id').map((p) => (partyIds ? `${p.id}|${p.name}` : p.name))
  return JSON.stringify({ bills, parties })
}

/** Throws a message with the seed and counts (never content) when the branches differ, something is still queued, or the server disagrees. */
export function assertConverged(h: HarnessV2, label: string, partyIds = false): void {
  const [first, ...rest] = h.sim.bs
  const ref = snapshotOf(first!, partyIds)
  rest.forEach((b) => {
    if (snapshotOf(b, partyIds) !== ref) throw new Error(`${label}: branch ${b.index} differs from branch 0 (counts: ${JSON.stringify(h.counts)})`)
  })
  for (const b of h.sim.bs) if (b.pendingCount() !== 0) throw new Error(`${label}: branch ${b.index} still has ${b.pendingCount()} waiting`)
  // the server and every branch agree on which bills are deleted
  for (const r of h.sim.server.records(h.sim.orgId)) {
    if (r.kind !== 'bill') continue
    const local = first!.bill(r.recId)
    if (!local) throw new Error(`${label}: server has a bill branch 0 does not`)
    if ((local.deletedAt !== null) !== r.deleted) throw new Error(`${label}: server and branch 0 disagree on the deleted flag of one bill`)
  }
}

export { SIM_BASE }
