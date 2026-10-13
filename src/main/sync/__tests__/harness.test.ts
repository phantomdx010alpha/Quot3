import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { formatMetrics, FlakyTransport, emptyMetrics } from '../flakyTransport'
import { InMemoryTransport, TransportError, POSTBOX_MAX_CIPHERTEXT } from '../transport'
import { createHarness, HARNESS_BASE, billInput, billState, allBillIds, rng, type Harness, type SimBranch } from './simHarness'
import { randomUUID } from 'node:crypto'
import { row } from '../../../shared/__fixtures__/bills'

const open: Harness[] = []
afterEach(() => open.splice(0).forEach((h) => h.close()))
const make = async (o: Parameters<typeof createHarness>[0]): Promise<Harness> => { const h = await createHarness(o); open.push(h); return h }

/** Runs `ops` random operations across the branches with a hostile network, then heals and settles. */
async function soak(h: Harness, ops: number, seed: number) {
  const rand = rng(seed * 7919)
  const n = h.bs.length
  let t = HARNESS_BASE
  const counts = { create: 0, edit: 0, delete: 0, restore: 0, refused: 0, push: 0, pull: 0, offline: 0 }
  const known = (b: SimBranch): string[] => allBillIds(b)
  for (let i = 0; i < ops; i++) {
    const b = h.bs[Math.floor(rand() * n)]!
    t += 500 + Math.floor(rand() * 20_000)
    b.setClock(t)
    const mine = known(b)
    const r = rand()
    try {
      if (mine.length === 0 || r < 0.18) { b.bills.save(billInput(randomUUID(), String(1 + Math.floor(rand() * 99)))); counts.create++ }
      else if (r < 0.50) { b.bills.save(billInput(mine[Math.floor(rand() * mine.length)]!, String(1 + Math.floor(rand() * 99)))); counts.edit++ }
      else if (r < 0.58) { b.bills.delete([mine[Math.floor(rand() * mine.length)]!]); counts.delete++ }
      else if (r < 0.64) { b.trash.restore([mine[Math.floor(rand() * mine.length)]!]); counts.restore++ }
      else if (r < 0.70) { h.setDown(rand() < 0.5); counts.offline++ }
      else if (r < 0.85) { await b.push.runOnce(); counts.push++ }
      else { await b.pull.runOnce(); counts.pull++ }
    } catch { counts.refused++ } // e.g. saving a deleted bill is refused: skip
  }
  h.heal()
  const rounds = await h.settle(20)
  return { rounds, counts }
}

function assertConverged(h: Harness, label: string): void {
  const first = h.bs[0]!
  const ids = allBillIds(first)
  for (const b of h.bs.slice(1)) expect(allBillIds(b), `${label}: same set of bills`).toEqual(ids)
  for (const id of ids) {
    const s = JSON.stringify(billState(first, id))
    for (const b of h.bs.slice(1)) expect(JSON.stringify(billState(b, id)), `${label}: bill ${id}`).toBe(s)
  }
  expect(h.mem.postboxSize, `${label}: postbox empty`).toBe(0)
  for (const b of h.bs) {
    expect(b.q<{ c: number }>("SELECT count(*) AS c FROM sync_outbox WHERE state IN ('pending','failed')")[0]!.c, `${label}: outbox drained`).toBe(0)
    expect(b.q<{ c: number }>("SELECT count(*) AS c FROM bills WHERE sync_state = 'pending'")[0]!.c, `${label}: nothing pending`).toBe(0)
  }
}

describe('two-branch simulation (Phase 60)', () => {
  it('FlakyTransport: seeded and repeatable; lost-before does nothing on the server, lost-after does it but the answer is lost', async () => {
    const mem = new InMemoryTransport(); mem.addLicense('Q3-ABCD-EFGH-JKLM')
    const mk = (seed: number, p: { dropBefore?: number; dropAfter?: number }) => new FlakyTransport(mem, { rand: rng(seed), maxDelayMs: 100, ...p })
    const a = mk(1, { dropBefore: 1 })
    await expect(a.touch({ license: 'Q3-ABCD-EFGH-JKLM', branchId: randomUUID() })).rejects.toBeInstanceOf(TransportError)
    expect(a.metrics.dropsBefore).toBe(1)
    expect(mem.calls).toHaveLength(0) // never reached the server
    const b = mk(2, { dropAfter: 1 })
    await expect(b.listBranches({ license: 'Q3-ABCD-EFGH-JKLM', branchId: randomUUID() })).rejects.toBeInstanceOf(TransportError)
    expect(mem.calls).toHaveLength(1)   // reached the server (which refused the unknown branch, hence a real answer was produced before the loss)
    const delays = (seed: number) => { const f = mk(seed, {}); return f.metrics }
    expect(delays(5)).toEqual(delays(5))
    const m = emptyMetrics(); m.calls = 3; m.byFn.push = 2
    expect(formatMetrics(m)).toContain('calls=3 (push=2)')
  })

  it('a push whose answer was lost is sent again: the other branch still ends with exactly one copy', async () => {
    const h = await make({ seed: 3, dropAfter: 1, only: ['push'] })
    const [a, b] = h.bs as [SimBranch, SimBranch]
    a.setClock(HARNESS_BASE); a.bills.save(billInput(randomUUID(), '10'))
    await a.push.runOnce()                       // server stored it, answer lost -> row stays pending
    expect(a.outbox.repo.counts().pending).toBe(1)
    expect(h.mem.postboxSize).toBe(1)
    h.heal()
    expect(await h.settle()).toBeGreaterThan(0)  // resent: the postbox now holds a duplicate, the apply is idempotent
    expect(allBillIds(b)).toHaveLength(1)
    expect(billState(b, allBillIds(b)[0]!)?.rows).toEqual(['Pen:10'])
    assertConverged(h, 'dup')
  })

  it('a bill over the payload limit is blamed and never sent; the bills around it still flow', async () => {
    const h = await make({ seed: 4 })
    const [a, b] = h.bs as [SimBranch, SimBranch]
    const big = randomUUID(), small = randomUUID()
    // Incompressible text so the sealed size really exceeds the 1 MiB server limit.
    const inp = billInput(big, '1')
    inp.bill.rows = Array.from({ length: 2500 }, () => row(randomBytes(700).toString('base64'), '1', '9')) // ~1.75 MB of text that does not compress
    a.setClock(HARNESS_BASE); a.bills.save(inp); a.bills.save(billInput(small, '2'))
    for (let i = 0; i < 12; i++) await a.push.runOnce()
    await b.pull.runOnce()
    expect(allBillIds(b)).toEqual([small])
    const failed = a.q<{ bill_id: string; state: string }>("SELECT bill_id, state FROM sync_outbox WHERE state = 'failed'")
    expect(failed.map((f) => f.bill_id)).toEqual([big])
    expect(h.mem.postboxSize).toBe(0)
  })

  it('clock skew: a branch whose clock is 10 minutes fast wins every race, but all branches still agree', async () => {
    const h = await make({ seed: 5, skewMs: [0, 600_000] })
    const [a, b] = h.bs as [SimBranch, SimBranch]
    const id = randomUUID()
    a.setClock(HARNESS_BASE); a.bills.save(billInput(id, '10'))
    await h.settle()
    a.setClock(HARNESS_BASE + 120_000); a.bills.save(billInput(id, '11'))  // A edits LATER in real time ...
    b.setClock(HARNESS_BASE + 60_000); b.bills.save(billInput(id, '22'))   // ... but B's fast clock stamps it later
    await h.settle()
    expect(billState(a, id)?.rows).toEqual(['Pen:22'])
    assertConverged(h, 'skew')
  })

  it('soak: 1000 randomized operations with drops, lost answers, delays and offline phases converge (3 seeds)', async () => {
    for (const seed of [11, 12, 13]) {
      const h = await make({ seed, dropBefore: 0.15, dropAfter: 0.1, maxDelayMs: 2000, skewMs: [0, 90_000] })
      const { rounds, counts } = await soak(h, 1000, seed)
      expect(rounds, `seed ${seed} settled`).toBeGreaterThan(0)
      assertConverged(h, `seed ${seed}`)
      // The run must really have exercised the hard paths, not just passed trivially.
      const m = h.metrics()
      expect(m.reduce((n, x) => n + x.dropsBefore, 0), `seed ${seed} lost-before`).toBeGreaterThan(0)
      expect(m.reduce((n, x) => n + x.dropsAfter, 0), `seed ${seed} lost-after`).toBeGreaterThan(0)
      expect(counts.create + counts.edit).toBeGreaterThan(300)
      expect(allBillIds(h.bs[0]!).length).toBeGreaterThan(20)
      if (seed === 11) console.info(`[sync-harness] seed ${seed} ops=${JSON.stringify(counts)} settledIn=${rounds} ` + m.map((x, i) => `${String.fromCharCode(65 + i)}: ${formatMetrics(x)}`).join(' | '))
      h.close(); open.length = 0
    }
  }, 120_000)
})
