import { afterEach, describe, expect, it } from 'vitest'
import { createCutoverService } from '../cutoverService'
import { CUTOVER_KEYS } from '../../../shared/sync/cutover'
import { SYNC_KEYS } from '../licenseService'
import { SharedTransportError } from '../sharedTransport'
import { createSim, billInput, U, silent, type Sim, type SimBranchV2 } from './sharedSim'

/**
 * Phase 140 simulation: two computers that were joined through a backup earlier (same bills, same ids), then each got bills the other does not
 * have, move to the shared notebook through the cutover service. Real temp SQLite, real compare / push / pull workers, in-memory server.
 * The owner's real numbers are 1 927 shared + 761 only on computer 1 + 1 166 only on computer 2; the default run uses a tenth of them so it
 * stays fast on every PC. `Q3_CUTOVER_FULL=1` runs the real sizes (a few minutes).
 */
const FULL = process.env.Q3_CUTOVER_FULL === '1'
const SHARED = FULL ? 1927 : 193
const ONLY_A = FULL ? 761 : 76
const ONLY_B = FULL ? 1166 : 117

const sims: Sim[] = []
const mk = async (): Promise<Sim> => { const s = await createSim({ branches: 2 }); sims.push(s); return s }
afterEach(() => sims.splice(0).forEach((s) => s.close()))

/** What one virtual computer needs for the cutover: a v1 activation on record, a fake backup, a counter for the v1 stop, a switch for "signed in". */
function wizard(b: SimBranchV2) {
  b.sync.setMany({ [SYNC_KEYS.licenseBlob]: 'v1-blob', [SYNC_KEYS.orgId]: 'v1-org', [SYNC_KEYS.licenseHint]: 'Q3-****-JKLM' })
  const c = { backups: 0, stops: 0, v1Reads: 0 }
  const flags = { signedIn: false }
  const svc = createCutoverService({
    sync: b.sync,
    backup: { create: async () => { c.backups++; return { file: `manual-${b.index}-${c.backups}.db` } } },
    stopV1: () => { c.stops++ },
    v2: { isActivated: () => flags.signedIn },
    compare: b.compare,
    customers: b.customers,
    log: silent
  })
  return { svc, c, flags }
}
const idsOf = (b: SimBranchV2): string[] => b.q<{ id: string }>('SELECT id FROM bills WHERE deleted_at IS NULL ORDER BY id').map((r) => r.id)
const content = (b: SimBranchV2): string[] => b.q<{ id: string; n: string }>("SELECT b.id AS id, group_concat(r.name_plain || ':' || coalesce(r.qty, ''), '|') AS n FROM bills b LEFT JOIN bill_rows r ON r.bill_id = b.id WHERE b.deleted_at IS NULL GROUP BY b.id ORDER BY b.id").map((r) => `${r.id}=${r.n}`)

async function seed(s: Sim): Promise<{ shared: string[]; onlyA: string[]; onlyB: string[] }> {
  const [A, B] = s.bs as [SimBranchV2, SimBranchV2]
  const shared: string[] = [], onlyA: string[] = [], onlyB: string[] = []
  B.sqlite.prepare("INSERT OR IGNORE INTO branches (id, name, po_prefix, is_local, created_at) VALUES (?, 'Branch A (backup join)', 'ZZ', 0, '2026-10-10T00:00:00.000Z')").run(A.id)
  for (let i = 0; i < SHARED; i++) { const id = U(`shared-${i}`); shared.push(id); A.bills.save(billInput(id, String(i + 1), { item: `S${i % 7}` })); B.bills.save(billInput(id, String(i + 1), { item: `S${i % 7}` })); B.sqlite.prepare('UPDATE bills SET branch_id = ? WHERE id = ?').run(A.id, id); for (const r of A.q<{ idx: number; id: string }>('SELECT idx, id FROM bill_rows WHERE bill_id = ?', id)) B.sqlite.prepare('UPDATE bill_rows SET id = ? WHERE bill_id = ? AND idx = ?').run(r.id, id, r.idx) /* Phase 143: a backup join keeps the creating branch id and the row ids, and both are part of the hashed content */ }
  for (let i = 0; i < ONLY_A; i++) { const id = U(`a-${i}`); onlyA.push(id); A.bills.save(billInput(id, '2', { item: `A${i % 5}` })) }
  for (let i = 0; i < ONLY_B; i++) { const id = U(`b-${i}`); onlyB.push(id); B.bills.save(billInput(id, '3', { item: `B${i % 5}` })) }
  return { shared, onlyA, onlyB }
}

/** Pushes and pulls ONE computer until its queue is empty (the other computer's workers stay still, as when it is switched off). */
async function syncOne(b: SimBranchV2): Promise<void> {
  for (let i = 0; i < 40 && (i === 0 || b.pendingCount() > 0); i++) { await b.push.runOnce() }
  await b.pull.runOnce()
}

/** The wizard on one computer, start to finish except the customer step. */
async function runWizard(b: SimBranchV2, w: ReturnType<typeof wizard>): Promise<void> {
  expect(w.svc.status().step).toBe('backup')
  await w.svc.begin()
  expect(w.svc.status().step).toBe('signin')
  w.flags.signedIn = true
  expect(w.svc.status().step).toBe('compare')
  const r = await w.svc.compare()
  expect(r.compare.state).toBe('done')
  await syncOne(b)
}

describe('cutover simulation: two computers end identical', () => {
  it('same bills + one-sided bills on each: after the wizard on each computer both hold exactly the union, with identical content', async () => {
    const s = await mk(); const [A, B] = s.bs as [SimBranchV2, SimBranchV2]
    const ids = await seed(s)
    const wa = wizard(A), wb = wizard(B)
    await runWizard(A, wa)
    // after computer 1: the server holds everything computer 1 had (shared + only-A) and computer 2 has not been touched
    expect(s.server.record(s.orgId, 'bill', ids.onlyA[0]!)).toBeDefined()
    expect(idsOf(B)).toHaveLength(SHARED + ONLY_B)
    await runWizard(B, wb)
    await s.settle()

    const all = [...ids.shared, ...ids.onlyA, ...ids.onlyB].sort()
    expect(idsOf(A)).toEqual(all)
    expect(idsOf(B)).toEqual(all)
    expect(content(A)).toEqual(content(B))
    expect(A.pendingCount() + B.pendingCount()).toBe(0)
    // the shared bills were not sent twice: they are still on version 1 on the server
    expect(s.server.record(s.orgId, 'bill', ids.shared[0]!)!.version).toBe(1)
    expect(s.server.record(s.orgId, 'bill', ids.shared[SHARED - 1]!)!.version).toBe(1)
  }, 280_000)

  it('the backup is made once per computer and before the old sync is stopped; the old license keys survive', async () => {
    const s = await mk(); const [A] = s.bs as [SimBranchV2]
    const w = wizard(A)
    await w.svc.begin(); await w.svc.begin()
    expect(w.c).toMatchObject({ backups: 1 })
    expect(w.c.stops).toBeGreaterThanOrEqual(1)
    expect(A.sync.get(CUTOVER_KEYS.v1Inert)).toBe('1')
    expect(A.sync.get(SYNC_KEYS.licenseBlob)).toBe('v1-blob')
  })

  it('re-running the whole wizard is a no-op: nothing is sent, fetched or re-versioned', async () => {
    const s = await mk(); const [A, B] = s.bs as [SimBranchV2, SimBranchV2]
    const ids = await seed(s)
    const wa = wizard(A), wb = wizard(B)
    await runWizard(A, wa); await runWizard(B, wb); await s.settle()
    const before = { a: content(A), b: content(B), seq: s.server.record(s.orgId, 'bill', ids.onlyB[0]!)!.version }
    for (const w of [wa, wb]) {
      await w.svc.begin()
      expect((await w.svc.compare()).compare).toMatchObject({ already: true })
    }
    await s.settle()
    expect(content(A)).toEqual(before.a); expect(content(B)).toEqual(before.b)
    expect(s.server.record(s.orgId, 'bill', ids.onlyB[0]!)!.version).toBe(before.seq)
    expect(A.pendingCount() + B.pendingCount()).toBe(0)
    expect(wa.c.backups).toBe(1); expect(wb.c.backups).toBe(1)
  }, 280_000)

  it('an interrupted wizard resumes: a restart after the backup, and a compare cut off by a connection loss, finish correctly', async () => {
    const s = await mk(); const [A, B] = s.bs as [SimBranchV2, SimBranchV2]
    const ids = await seed(s)
    const wa = wizard(A), wb = wizard(B)
    await runWizard(A, wa)
    // computer 2: backup, then "the app is closed": a brand-new service object over the same stored state
    await wb.svc.begin()
    const again = createCutoverService({ sync: B.sync, backup: { create: async () => { wb.c.backups++; return { file: 'x.db' } } }, stopV1: () => { wb.c.stops++ }, v2: { isActivated: () => wb.flags.signedIn }, compare: B.compare, customers: B.customers, log: silent })
    expect(again.status()).toMatchObject({ step: 'signin', v1Inert: true })
    wb.flags.signedIn = true
    // first compare attempt: the connection drops while the party kind is read
    const inner = B.wrapped.current
    let fail = true
    B.wrapped.current = new Proxy(inner, {
      get(t, p, r) {
        if (p === 'manifest') return async (a: { kind: string }) => { if (a.kind === 'party' && fail) throw new SharedTransportError('offline'); return (t as never as { manifest(x: unknown): Promise<unknown> }).manifest(a) }
        const v = Reflect.get(t, p, r)
        return typeof v === 'function' ? v.bind(t) : v
      }
    }) as typeof inner
    const first = await again.compare()
    expect(first.compare.state).toBe('paused'); expect(first.status.step).toBe('compare')
    fail = false
    const second = await again.compare()
    expect(second.compare.state).toBe('done'); expect(second.status.step).toBe('unify')
    await s.settle()
    expect(wb.c.backups).toBe(1) // no second backup
    const all = [...ids.shared, ...ids.onlyA, ...ids.onlyB].sort()
    expect(idsOf(A)).toEqual(all); expect(idsOf(B)).toEqual(all)
    expect(content(A)).toEqual(content(B))
  }, 280_000)

  it('the customer step: joins exact-same-name customers on ONE computer and finishes; the other computer then only receives', async () => {
    const s = await createSim({ branches: 2, parties: true }); sims.push(s)
    const [A, B] = s.bs as [SimBranchV2, SimBranchV2]
    A.bills.save(billInput(U('c1'), '1', { name: 'Ruby Traders' })); B.bills.save(billInput(U('c2'), '1', { name: 'ruby  traders' }))
    const wa = wizard(A), wb = wizard(B)
    await runWizard(A, wa); await runWizard(B, wb); await s.settle()
    const u = wa.svc.unify({ skip: false })
    expect(u.status).toMatchObject({ step: 'done', needed: false })
    expect(wb.svc.status().step).toBe('unify') // the other computer has not decided yet
    expect(wb.svc.unify({ skip: true }).status.step).toBe('done')
    await s.settle()
    expect(A.partyRepo.list().length).toBeGreaterThan(0)
  }, 120_000)
})
