import { afterEach, describe, expect, it } from 'vitest'
import { createSim, billInput, U, type Sim, type SimBranchV2 } from './sharedSim'

/**
 * Phase 143 - Milestone 12 performance gate for the sync engine: real temp SQLite, real compare / push / pull workers, in-memory server
 * (no network, so these numbers are the CLIENT cost only; the real round trips to Supabase are a standing gap).
 *
 * Budgets are [A] (the plan names none) and deliberately generous: they only catch an order-of-magnitude regression or a wrong result,
 * because speed depends on the machine. The measured numbers are printed (`[perf143] ...`) and recorded in PHASE_STATUS.md.
 * Sizes: `Q3_PERF_COMPARE_BILLS` (2000), `Q3_PERF_PULL_RECORDS` (1000). Never logs bill content.
 */
const COMPARE_BILLS = Number(process.env.Q3_PERF_COMPARE_BILLS ?? 2000)
const PULL_RECORDS = Number(process.env.Q3_PERF_PULL_RECORDS ?? 1000)
const BUDGET_COMPARE_MS = 20_000
const BUDGET_PULL_MS = 20_000

const sims: Sim[] = []
const mk = async (): Promise<Sim> => { const s = await createSim({ branches: 2 }); sims.push(s); return s }
afterEach(() => sims.splice(0).forEach((s) => s.close()))

const seedBills = (b: SimBranchV2, n: number, tag: string): void => { for (let i = 0; i < n; i++) b.bills.save(billInput(U(`${tag}-${i}`), String((i % 9) + 1), { item: `P${i % 11}` })) }
const timed = async <T>(f: () => Promise<T>): Promise<{ ms: number; value: T }> => { const t0 = performance.now(); const value = await f(); return { ms: Math.round(performance.now() - t0), value } }
const report = (what: string, ms: number, extra: string): void => { console.log(`[perf143] ${what}: ${ms} ms (${extra})`) }

describe('Phase 143 perf: first compare', () => {
  it(`a ${COMPARE_BILLS}-bill first compare against an EMPTY server (everything uploads) finishes inside the budget`, async () => {
    const s = await mk(); const [A] = s.bs as [SimBranchV2, SimBranchV2]
    seedBills(A, COMPARE_BILLS, 'up')
    const { ms, value } = await timed(() => A.compare.run())
    report('first compare, all upload', ms, `${COMPARE_BILLS} bills`)
    expect(value.state).toBe('done')
    expect(value.upload).toBe(COMPARE_BILLS)
    expect(value.skip + value.download + value.conflict).toBe(0)
    expect(ms).toBeLessThan(BUDGET_COMPARE_MS)
    // queued, not yet sent: the compare itself sends nothing
    expect(A.pendingCount()).toBe(COMPARE_BILLS)
  }, 120_000)

  it(`a second computer with NO bills compares against a server holding ${COMPARE_BILLS} bills (everything downloads), then pulls them all`, async () => {
    const s = await mk(); const [A, B] = s.bs as [SimBranchV2, SimBranchV2]
    seedBills(A, COMPARE_BILLS, 'dl')
    await A.compare.run()
    const push = await timed(async () => { for (let i = 0; i < 400 && A.pendingCount() > 0; i++) await A.push.runOnce() })
    report('push of the queue (client side)', push.ms, `${COMPARE_BILLS} bills`)
    expect(A.pendingCount()).toBe(0)
    const cmp = await timed(() => B.compare.run())
    report('first compare, all download', cmp.ms, `${COMPARE_BILLS} bills on the server`)
    expect(cmp.value.state).toBe('done')
    expect(cmp.value.download).toBe(COMPARE_BILLS)
    expect(cmp.ms).toBeLessThan(BUDGET_COMPARE_MS)
    const pull = await timed(async () => { for (let i = 0; i < 40; i++) { await B.pull.runOnce(); if (B.q<{ n: number }>('SELECT count(*) AS n FROM bills')[0]!.n >= COMPARE_BILLS) break } })
    report('pull until complete', pull.ms, `${COMPARE_BILLS} bills`)
    expect(B.q<{ n: number }>('SELECT count(*) AS n FROM bills WHERE deleted_at IS NULL')[0]!.n).toBe(COMPARE_BILLS)
    expect(pull.ms).toBeLessThan(BUDGET_PULL_MS * 4)
  }, 280_000)
})

describe('Phase 143 perf: pulling a 1 000-record batch', () => {
  it(`one pull run applies ${PULL_RECORDS} records (pages of 200) inside the budget, and a second run finds nothing`, async () => {
    const s = await mk(); const [A, B] = s.bs as [SimBranchV2, SimBranchV2]
    seedBills(A, PULL_RECORDS, 'pg')
    for (let i = 0; i < 400 && (i === 0 || A.pendingCount() > 0); i++) await A.push.runOnce()
    expect(A.pendingCount()).toBe(0)
    const first = await timed(() => B.pull.runOnce())
    const got = B.q<{ n: number }>('SELECT count(*) AS n FROM bills WHERE deleted_at IS NULL')[0]!.n
    report('pull run', first.ms, `${got} of ${PULL_RECORDS} records applied in one run`)
    expect(got).toBe(PULL_RECORDS)
    expect(first.ms).toBeLessThan(BUDGET_PULL_MS)
    const again = await timed(() => B.pull.runOnce())
    report('pull run with nothing new', again.ms, 'idle poll')
    expect(B.q<{ n: number }>('SELECT count(*) AS n FROM bills')[0]!.n).toBe(PULL_RECORDS)
    expect(B.pendingCount()).toBe(0) // applying remote records never echoes back into the outbox
    expect(again.ms).toBeLessThan(2_000)
  }, 280_000)
})
