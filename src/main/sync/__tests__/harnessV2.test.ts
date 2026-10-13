import { afterEach, describe, expect, it } from 'vitest'
import { encodeRecord } from '../../../shared/sync/codecV2'
import { serializeBill } from '../../../shared/billModel'
import { FlakySharedTransport } from '../flakyTransport'
import { InMemorySharedServer, InMemorySharedTransport, SharedTransportError } from '../sharedTransport'
import { assertConverged, createHarnessV2, rng, snapshotOf, SOAK_SEED, type HarnessV2, type HarnessV2Options } from './simHarnessV2'
import { billInput, U, type SimBranchV2 } from './sharedSim'

/**
 * Phase 141: convergence under bad conditions, no real server. Fixed seeds only; a failure prints the seed and counts (never bill content).
 * Windows-flake note for the soak: see `simHarnessV2.ts` (a red soak on Windows is a timeout first, rerun with a larger --testTimeout).
 */
const open: HarnessV2[] = []
const mk = async (o: HarnessV2Options): Promise<HarnessV2> => { const h = await createHarnessV2(o); open.push(h); return h }
afterEach(() => open.splice(0).forEach((h) => h.close()))
const LOSSY = { dropBefore: 0.12, dropAfter: 0.1, duplicate: 0.15, maxDelayMs: 800 }

describe('FlakySharedTransport (the wrapper itself)', () => {
  const setup = async (o: ConstructorParameters<typeof FlakySharedTransport>[1]) => {
    const server = new InMemorySharedServer({ now: () => Date.UTC(2026, 9, 13) })
    const { orgId } = server.addOrg({ licenseKey: 'Q3-ABCD-EFGH-JKLM', seats: [{ email: 's@example.com', password: 'pw' }] })
    const inner = new InMemorySharedTransport(server)
    await inner.signIn({ email: 's@example.com', password: 'pw' })
    const branchId = U('flaky-branch')
    await inner.activate({ license: 'Q3-ABCD-EFGH-JKLM', branchId, name: 'Branch XX', poPrefix: 'XX', device: 'PC', takeover: false })
    const scope = { license: 'Q3-ABCD-EFGH-JKLM', branchId }
    const item = { kind: 'bill' as const, recId: U('rec'), baseVersion: 0, payload: { v: 1 }, payloadHash: 'hash0001', schemaVer: 1, minReaderVer: 1, appVer: '1', editedAt: '2026-10-13T00:00:00.000Z', deleted: false }
    return { server, orgId, scope, item, f: new FlakySharedTransport(inner, o) }
  }
  it('a request lost BEFORE the server changes nothing; a lost ANSWER leaves the work done; both are connection errors', async () => {
    const a = await setup({ rand: () => 0.0, dropBefore: 1 })
    await expect(a.f.push({ ...a.scope, items: [a.item] })).rejects.toBeInstanceOf(SharedTransportError)
    expect(a.server.records(a.orgId)).toHaveLength(0)
    const b = await setup({ rand: () => 0.99, dropAfter: 1.1 })
    await expect(b.f.push({ ...b.scope, items: [b.item] })).rejects.toMatchObject({ kind: expect.stringMatching(/offline|timeout/) })
    expect(b.server.records(b.orgId)).toHaveLength(1)
  })
  it('duplicate delivery is absorbed by the server (noop), and the network switch refuses everything on the data path', async () => {
    let down = false
    const c = await setup({ rand: () => 0.0, duplicate: 1, down: () => down })
    const r = await c.f.push({ ...c.scope, items: [c.item] })
    expect(r[0]).toMatchObject({ outcome: 'accepted', version: 1 })
    expect(c.f.metrics.duplicates).toBe(1)
    expect(c.server.record(c.orgId, 'bill', c.item.recId)).toMatchObject({ version: 1 })
    down = true
    await expect(c.f.pull({ ...c.scope, afterSeq: 0 })).rejects.toMatchObject({ kind: 'offline' })
    expect(c.f.metrics.downRefusals).toBe(1)
  })
})

describe('seeded property: random edits, deletes, restores on 3 branches, then a full sync = identical content everywhere', () => {
  for (const seed of [101, 102, 103, 104, 105, 106]) {
    it(`seed ${seed}: 3 branches, 60 operations over a lossy network`, async () => {
      const h = await mk({ seed, branches: 3, loss: LOSSY })
      await h.run(60)
      await h.converge()
      assertConverged(h, `seed ${seed}`)
    })
  }
  it('4 branches with customers travelling too (seed 201)', async () => {
    const h = await mk({ seed: 201, branches: 4, parties: true, loss: LOSSY })
    await h.run(80)
    await h.converge()
    assertConverged(h, 'seed 201', true)
    const live = h.sim.bs[0]!.q<{ n: number }>('SELECT count(*) AS n FROM parties WHERE deleted_at IS NULL')[0]!.n
    expect(live).toBeGreaterThan(0)
  })
  it('the harness really injects trouble (a green run is not an empty run)', async () => {
    const h = await mk({ seed: 102, branches: 3, loss: LOSSY })
    await h.run(120)
    const m = h.metrics()
    expect(m.dropsBefore).toBeGreaterThan(0); expect(m.dropsAfter).toBeGreaterThan(0); expect(m.duplicates).toBeGreaterThan(0)
    expect(h.counts.edit).toBeGreaterThan(10); expect(h.counts.delete + h.counts.restore).toBeGreaterThan(3)
    await h.converge(); assertConverged(h, 'seed 102 long')
  })
  it('replays: the same seed gives the same final content', async () => {
    const run = async (): Promise<string> => { const h = await createHarnessV2({ seed: 777, branches: 3, loss: LOSSY }); try { await h.run(50); await h.converge(); assertConverged(h, 'seed 777'); return snapshotOf(h.sim.bs[0]!) } finally { h.close() } }
    const first = await run(); const second = await run()
    expect(second).toBe(first)
  })
  it('re-running a full sync afterwards changes nothing (idempotent)', async () => {
    const h = await mk({ seed: 103, branches: 3, loss: LOSSY })
    await h.run(40); await h.converge()
    const before = h.sim.bs.map((b) => snapshotOf(b)); const seq = h.sim.server.records(h.sim.orgId).map((r) => `${r.recId}:${r.version}`)
    await h.sim.settle(3)
    expect(h.sim.bs.map((b) => snapshotOf(b))).toEqual(before)
    expect(h.sim.server.records(h.sim.orgId).map((r) => `${r.recId}:${r.version}`)).toEqual(seq)
  })
})

describe('no network while editing', () => {
  it('three branches edit, delete and restore with the network DOWN; nothing reaches the server; when it is back all end identical', async () => {
    const h = await mk({ seed: 301, branches: 3 })
    h.net.down = true
    for (let i = 0; i < 40; i++) { const k = await h.step(); if (k === 'netflip') h.net.down = true }
    expect(h.sim.server.records(h.sim.orgId)).toHaveLength(0)
    expect(h.sim.bs.some((b) => b.pendingCount() > 0)).toBe(true)
    await h.converge(); assertConverged(h, 'offline phase')
  })
})

describe('customers: a merge and its undo while other branches edit bills', () => {
  it('a merge on one branch reaches the others, then its undo reaches them too', async () => {
    const h = await mk({ seed: 401, branches: 3, parties: true })
    const [A, B, C] = h.sim.bs as [SimBranchV2, SimBranchV2, SimBranchV2]
    A.bills.save(billInput(U('m-1'), '1', { name: 'Alpha Traders' }))
    B.bills.save(billInput(U('m-2'), '2', { name: 'Alpha Trader' }))
    await h.sim.settle()
    const live = (b: SimBranchV2): string[] => b.q<{ id: string }>('SELECT id FROM parties WHERE deleted_at IS NULL ORDER BY id').map((p) => p.id)
    const two = live(A); expect(two).toHaveLength(2); expect(live(B)).toEqual(two); expect(live(C)).toEqual(two)
    const [survivorId, mergedId] = two as [string, string]
    expect(A.customers.merge({ survivorId, mergedId })).toBeTruthy()
    C.bills.save(billInput(U('m-3'), '3', { name: 'Delta Mart' })) // unrelated edit meanwhile
    await h.sim.settle()
    expect(live(B)).toEqual(live(A)); expect(live(C)).toEqual(live(A))
    expect(live(A)).toContain(survivorId); expect(live(A)).not.toContain(mergedId)
    expect(A.customers.undoLastMerge().undone).toBeGreaterThan(0)
    await h.sim.settle()
    expect(live(A)).toContain(mergedId); expect(live(B)).toEqual(live(A)); expect(live(C)).toEqual(live(A))
    assertConverged(h, 'merge + undo', true)
  })
})

describe('version skew: an older reader sets a record aside and applies it after the update', () => {
  it('B (old app) keeps its copy and counts the newer one; A and C (new app) read it; after the update B is identical; nothing was overwritten or deleted', async () => {
    const h = await mk({ seed: 501, branches: 3 })
    const [A, B, C] = h.sim.bs as [SimBranchV2, SimBranchV2, SimBranchV2]
    A.setReaderVer(2); C.setReaderVer(2)
    const id = U('skew-1')
    A.bills.save(billInput(id, '1')); await h.sim.settle()
    expect(B.rows(id)).toEqual(['Pen:1'])
    // a newer app on another computer rewrote the bill (server version 2, readers below 2 must set it aside)
    const sb = serializeBill(A.bills.getForEdit(id)); const { syncState: _s, ...rec } = sb.bill; void _s
    const e = encodeRecord({ kind: 'bill', recId: id, data: { bill: { ...rec, formatId: rec.formatId }, rows: sb.rows.map((r) => ({ ...r, qty: '42' })) }, deleted: false, editedAt: '2026-10-13T00:00:00.000Z', appVer: '9.0.0' })
    const cur = h.sim.server.record(h.sim.orgId, 'bill', id)!
    h.sim.server.seedRecord(h.sim.orgId, { kind: 'bill', recId: id, version: cur.version + 1, payload: { ...e.payload, futureField: true }, payloadHash: e.payloadHash, editedAt: e.editedAt, fromBranch: A.id, minReaderVer: 2 })
    await h.sim.settle()
    expect(A.rows(id)).toEqual(['Pen:42']); expect(C.rows(id)).toEqual(['Pen:42'])
    expect(B.rows(id)).toEqual(['Pen:1']); expect(B.aside.count()).toBe(1) // set aside, not stripped, not deleted
    expect(h.sim.server.record(h.sim.orgId, 'bill', id)).toMatchObject({ minReaderVer: 2, deleted: false })
    // B's pending local edits to OTHER bills still flow while this one is aside
    B.bills.save(billInput(U('skew-2'), '7')); await h.sim.settle()
    expect(A.rows(U('skew-2'))).toEqual(['Pen:7'])
    // B is updated
    B.setReaderVer(2)
    expect(B.aside.retryAside()).toMatchObject({ applied: 1, stillAside: 0, failed: 0 })
    await h.sim.settle()
    expect(B.aside.count()).toBe(0)
    assertConverged(h, 'version skew')
  })
})

describe('clock offsets: the later REAL edit wins, whatever the Windows clocks say', () => {
  /** A's clock runs 10 min fast, B's 10 min slow. Both edit the same bill from the same base while offline; B's edit is 30 s later in real time. */
  async function scene(pushOrder: 'AB' | 'BA') {
    const h = await mk({ seed: 601, branches: 3, skewMs: [10 * 60 * 1000, -10 * 60 * 1000, 0] })
    const [A, B, C] = h.sim.bs as [SimBranchV2, SimBranchV2, SimBranchV2]
    const id = U('clock-1')
    A.bills.save(billInput(id, '1')); await h.sim.settle()
    for (const b of h.sim.bs) await b.push.runOnce() // each branch measures its own clock offset at contact
    h.sim.tick(60 * 1000)
    A.bills.save(billInput(id, '100', { expectedRevision: A.bill(id)!.revision }))
    h.sim.tick(30 * 1000)
    B.bills.save(billInput(id, '200', { expectedRevision: B.bill(id)!.revision }))
    const order = pushOrder === 'AB' ? [A, B] : [B, A]
    for (const b of order) await b.push.runOnce()
    await h.sim.settle(); await h.sim.settle()
    return { h, A, B, C, id }
  }
  for (const order of ['AB', 'BA'] as const) {
    it(`push order ${order}: B's later real edit wins on every branch; the loser is kept on the server and as a local revision`, async () => {
      const { h, A, B, C, id } = await scene(order)
      expect(A.rows(id)).toEqual(['Pen:200']); expect(B.rows(id)).toEqual(['Pen:200']); expect(C.rows(id)).toEqual(['Pen:200'])
      expect(h.sim.server.historyOf(h.sim.orgId, 'bill', id).some((x) => x.reason === 'conflict_loser' || x.reason === 'superseded')).toBe(true)
      const kept = A.revisions(id).some((r) => r.snapshotJson.includes('100')) || h.sim.server.historyOf(h.sim.orgId, 'bill', id).some((x) => JSON.stringify(x.payload).includes('100'))
      expect(kept).toBe(true) // the losing version is never thrown away
      assertConverged(h, `clock ${order}`)
    })
  }
  it('with the SAME skew on both sides the later edit still wins (control)', async () => {
    const h = await mk({ seed: 602, branches: 2 })
    const [A, B] = h.sim.bs as [SimBranchV2, SimBranchV2]
    const id = U('clock-2'); A.bills.save(billInput(id, '1')); await h.sim.settle()
    h.sim.tick(1000); A.bills.save(billInput(id, '5', { expectedRevision: A.bill(id)!.revision }))
    h.sim.tick(1000); B.bills.save(billInput(id, '6', { expectedRevision: B.bill(id)!.revision }))
    await B.push.runOnce(); await A.push.runOnce(); await h.sim.settle(); await h.sim.settle()
    expect(A.rows(id)).toEqual(['Pen:6']); expect(B.rows(id)).toEqual(['Pen:6'])
  })
})

describe('soak: 1 000 operations on 3 branches over a lossy network', () => {
  it(`fixed seed ${SOAK_SEED}: ends identical everywhere; timing and counts are printed`, async () => {
    const t0 = Date.now()
    const h = await mk({ seed: SOAK_SEED, branches: 3, loss: LOSSY, billPool: 30 })
    await h.run(1000)
    const t1 = Date.now()
    await h.converge()
    assertConverged(h, `soak seed ${SOAK_SEED}`)
    const m = h.metrics()
    // eslint-disable-next-line no-console
    console.log(`[soak] seed=${SOAK_SEED} ops=${JSON.stringify(h.counts)} run=${t1 - t0}ms converge=${Date.now() - t1}ms calls=${m.calls} lostBefore=${m.dropsBefore} lostAfter=${m.dropsAfter} dup=${m.duplicates} down=${m.downRefusals} serverRecords=${h.sim.server.records(h.sim.orgId).length}`)
    expect(h.counts.edit).toBeGreaterThan(300)
  }, 280_000)
})

void rng
