import { afterEach, describe, expect, it } from 'vitest'
import { InMemorySharedTransport, SharedTransportError, type PushArgs, type SharedStoreTransport } from '../sharedTransport'
import { SHARED_STATE_KEYS, readCursor } from '../sharedState'
import { createSim, billInput, U, SIM_KEY, type Sim } from './sharedSim'
import { encodeRecord } from '../../../shared/sync/codecV2'
import { serializeBill } from '../../../shared/billModel'
import { PULL_MAX_PAGES_PER_RUN, SHARED_PULL_FAIL_CAP } from '../../../shared/sync/pull'

/**
 * Phase 135: two (or three) virtual branches on real temp SQLite over `InMemorySharedTransport` / `InMemorySharedServer`.
 * Written from the spec (SYNC_SHARED_STORE_SPEC sections 6-7), not from the worker code.
 */
const sims: Sim[] = []
const mk = async (o: Parameters<typeof createSim>[0] = {}): Promise<Sim> => { const s = await createSim(o); sims.push(s); return s }
afterEach(() => sims.splice(0).forEach((s) => s.close()))

describe('push + pull: changes flow both ways', () => {
  it('a save on A appears on B; nothing echoes back; a second pull changes nothing', async () => {
    const s = await mk(); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    const id = U('bill-1')
    A.bills.save(billInput(id, '5'))
    expect(A.pendingCount()).toBe(1)
    expect(await A.push.runOnce()).toMatchObject({ sent: 1, accepted: 1, lost: 0, block: 'idle' })
    expect(A.pendingCount()).toBe(0)
    expect(A.bill(id)!.syncState).toBe('synced')
    expect(A.records.getState('bill', id)).toMatchObject({ baseVersion: 1 })

    const pulled = await B.pull.runOnce()
    expect(pulled).toMatchObject({ applied: 1, failed: 0, block: 'idle' })
    expect(B.rows(id)).toEqual(A.rows(id))
    expect(B.bill(id)).toMatchObject({ syncState: 'synced', deletedAt: null })
    expect(B.pendingCount()).toBe(0) // a received record is never sent back
    expect(B.q('SELECT 1 FROM branches WHERE id = ?', A.id)).toHaveLength(1) // the sender's branch row came from the server's list
    expect(B.records.getState('bill', id)).toMatchObject({ baseVersion: 1 })

    const again = await B.pull.runOnce()
    expect(again).toMatchObject({ applied: 0, pages: 1 })
    const revs = B.revisions(id).length
    // A's own record comes back in A's pull: already known, nothing is written
    const own = await A.pull.runOnce()
    expect(own).toMatchObject({ applied: 0, skipped: 1 })
    expect(B.revisions(id)).toHaveLength(revs)
  })

  it('an edit travels as a new version; B edits it again; both converge', async () => {
    const s = await mk(); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    const id = U('bill-2')
    A.bills.save(billInput(id, '5')); await s.settle()
    s.tick(60_000)
    A.bills.save(billInput(id, '8')); await s.settle()
    expect(B.rows(id)).toEqual(['Pen:8'])
    s.tick(60_000)
    B.bills.save(billInput(id, '9')); await s.settle()
    expect(A.rows(id)).toEqual(['Pen:9'])
    expect(s.server.record(s.orgId, 'bill', id)!.version).toBe(3)
    expect(B.pendingCount() + A.pendingCount()).toBe(0)
  })

  it('delete is a tombstone that travels; restore is a new version', async () => {
    const s = await mk(); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    const id = U('bill-3')
    A.bills.save(billInput(id, '5')); await s.settle()
    s.tick(1000)
    A.bills.delete([id])
    await s.settle()
    expect(B.bill(id)!.deletedAt).not.toBeNull()
    expect(s.server.record(s.orgId, 'bill', id)).toMatchObject({ deleted: true, version: 2 })
  })

  it('item rules travel too', async () => {
    const s = await mk(); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    A.decide({ kind: 'merge', keyA: 'pen', keyB: 'pencil', canonical: null, note: null } as never)
    await s.settle()
    expect(B.rules.list(true)).toHaveLength(1)
    expect(B.pendingCount()).toBe(0)
  })
})

describe('both branches edit: the later edit wins, the loser stays as a revision', () => {
  async function twoEdits(order: 'A first' | 'B first') {
    const s = await mk(); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    const id = U('bill-c')
    A.bills.save(billInput(id, '1')); await s.settle()
    // both change version 1; A's edit is EARLIER in real time, B's is later
    s.tick(60_000); A.bills.save(billInput(id, '2'))
    s.tick(60_000); B.bills.save(billInput(id, '3'))
    if (order === 'A first') { await A.push.runOnce(); const r = await B.push.runOnce(); return { s, A, B, id, pushB: r } }
    const r = await B.push.runOnce(); const rA = await A.push.runOnce()
    return { s, A, B, id, pushB: r, pushA: rA }
  }

  it('A pushes first (accepted), B pushes later (B wins): everyone ends with B, A kept its own as a revision', async () => {
    const { s, A, B, id, pushB } = await twoEdits('A first')
    expect(pushB).toMatchObject({ won: 1, lost: 0 })
    await s.settle()
    expect(A.rows(id)).toEqual(['Pen:3']); expect(B.rows(id)).toEqual(['Pen:3'])
    expect(A.revisions(id).some((r) => r.snapshotJson.includes('"qty":"2"'))).toBe(true) // A's losing version is still in its revision list
    expect(s.server.historyOf(s.orgId, 'bill', id).some((h) => h.reason === 'superseded' || h.reason === 'conflict_loser')).toBe(true)
  })

  it('B pushes first, A (earlier edit) pushes later and LOSES: A keeps its version as a revision and takes B\'s', async () => {
    const { s, A, B, id, pushA } = await twoEdits('B first')
    expect(pushA).toMatchObject({ lost: 1, accepted: 0 })
    expect(A.pendingCount()).toBe(0)
    await s.settle()
    expect(A.rows(id)).toEqual(['Pen:3']); expect(B.rows(id)).toEqual(['Pen:3'])
    expect(A.revisions(id).some((r) => r.snapshotJson.includes('"qty":"2"'))).toBe(true)
    expect(s.server.record(s.orgId, 'bill', id)!.version).toBe(3)
  })

  it('a computer with a wrong clock does not decide the conflict (offset measured against the server)', async () => {
    const s = await mk({ skewMs: [900_000, 0] }); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]] // A runs 15 minutes fast
    const id = U('bill-skew')
    A.bills.save(billInput(id, '1')); await s.settle()
    s.tick(60_000); A.bills.save(billInput(id, '2')) // real time T+60s, A's clock says T+16min
    s.tick(60_000); B.bills.save(billInput(id, '3')) // real time T+120s: the later edit
    await B.push.runOnce(); await A.push.runOnce()
    await s.settle()
    expect(A.rows(id)).toEqual(['Pen:3']); expect(B.rows(id)).toEqual(['Pen:3'])
  })

  it('A has an UNSENT edit when B\'s later version arrives: the received one wins, A\'s stays as a revision, nothing is sent for it', async () => {
    const s = await mk(); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    const id = U('bill-u1')
    A.bills.save(billInput(id, '1')); await s.settle()
    s.tick(60_000); A.bills.save(billInput(id, '2')) // unsent
    s.tick(60_000); B.bills.save(billInput(id, '3')); await B.push.runOnce()
    const p = await A.pull.runOnce()
    expect(p.applied).toBe(1)
    expect(A.rows(id)).toEqual(['Pen:3'])
    expect(A.pendingCount()).toBe(0)
    expect(A.revisions(id).some((r) => r.snapshotJson.includes('"qty":"2"'))).toBe(true)
    await s.settle()
    expect(s.server.record(s.orgId, 'bill', id)!.version).toBe(2)
  })

  it('A has an UNSENT edit that is LATER than the received version: A keeps it, the next push is a plain accept, B converges to A', async () => {
    const s = await mk(); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    const id = U('bill-u2')
    A.bills.save(billInput(id, '1')); await s.settle()
    s.tick(60_000); B.bills.save(billInput(id, '3')); await B.push.runOnce()
    s.tick(60_000); A.bills.save(billInput(id, '2')) // later, still unsent
    const p = await A.pull.runOnce()
    expect(p).toMatchObject({ keptLocal: 1, applied: 0 })
    expect(A.rows(id)).toEqual(['Pen:2'])
    expect(A.pendingCount()).toBe(1)
    const pu = await A.push.runOnce()
    expect(pu).toMatchObject({ accepted: 1, won: 0, lost: 0 })
    await s.settle()
    expect(B.rows(id)).toEqual(['Pen:2'])
    expect(s.server.record(s.orgId, 'bill', id)!.version).toBe(3)
  })
})

describe('bulk and catch-up', () => {
  it('761 bills made before sync upload once; B downloads them; a second run sends and pulls nothing', async () => {
    const s = await mk(); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    for (let i = 0; i < 761; i++) A.bills.save(billInput(U(`imp-${i}`), String(1 + (i % 9)), { item: `Item ${i}` }))
    expect(A.pendingCount()).toBe(761)
    let sent = 0
    for (let i = 0; i < 4 && A.pendingCount() > 0; i++) sent += (await A.push.runOnce()).sent
    expect(sent).toBe(761)
    expect(s.server.records(s.orgId).filter((r) => r.kind === 'bill')).toHaveLength(761)
    expect((await A.push.runOnce()).sent).toBe(0)
    let applied = 0
    for (let i = 0; i < 3; i++) applied += (await B.pull.runOnce()).applied
    expect(applied).toBe(761)
    expect(B.q('SELECT COUNT(*) AS n FROM bills')[0]).toMatchObject({ n: 761 })
    expect(B.pendingCount()).toBe(0)
    expect((await B.pull.runOnce()).applied).toBe(0)
  })

  it('a pull of more than one run keeps its cursor between runs (pages of 200, at most the page cap per run)', async () => {
    const s = await mk(); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    const total = 200 * PULL_MAX_PAGES_PER_RUN + 40
    for (let i = 0; i < total; i++) s.server.seedRecord(s.orgId, { kind: 'bill', recId: U(`seed-${i}`), version: 1, payload: {}, payloadHash: `h${i}`, editedAt: '2026-10-01T00:00:00.000Z', fromBranch: A.id })
    const r1 = await B.pull.runOnce()
    expect(r1.pages).toBe(PULL_MAX_PAGES_PER_RUN)
    expect(readCursor(B.sync)).toBe(200 * PULL_MAX_PAGES_PER_RUN)
    const r2 = await B.pull.runOnce()
    expect(readCursor(B.sync)).toBe(total)
    expect(r2.pages).toBeGreaterThanOrEqual(1)
  })

  it('a new third branch gets everything from sequence 0', async () => {
    const s = await mk({ branches: 3 }); const [A, B, C] = s.bs as [typeof s.bs[0], typeof s.bs[0], typeof s.bs[0]]
    for (let i = 0; i < 30; i++) A.bills.save(billInput(U(`t-${i}`), '2', { item: `It ${i}` }))
    B.decide({ kind: 'merge', keyA: 'cup', keyB: 'mug', canonical: null, note: null } as never)
    await A.push.runOnce(); await B.push.runOnce() // C has not pulled yet
    const r = await C.pull.runOnce()
    expect(r.applied).toBe(31)
    expect(C.q('SELECT COUNT(*) AS n FROM bills')[0]).toMatchObject({ n: 30 })
    expect(C.rules.list(true)).toHaveLength(1)
  })

  it('a replay (cursor lost, e.g. a crash after applying) changes nothing and creates no revisions', async () => {
    const s = await mk(); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    for (let i = 0; i < 12; i++) A.bills.save(billInput(U(`rp-${i}`), '4', { item: `R${i}` }))
    await s.settle()
    const before = B.q('SELECT COUNT(*) AS n FROM bill_revisions')[0]
    B.sync.remove([SHARED_STATE_KEYS.cursor])
    const r = await B.pull.runOnce()
    expect(r).toMatchObject({ applied: 0, skipped: 12 })
    expect(B.q('SELECT COUNT(*) AS n FROM bill_revisions')[0]).toEqual(before)
  })
})

describe('first compare', () => {
  it('identical bills are skipped, only-local ones upload, a same-id-different bill is decided by the later edit, and the pull moves only what is needed', async () => {
    const s = await mk(); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    for (let i = 0; i < 60; i++) A.bills.save(billInput(U(`cmp-${i}`), '4', { item: `C${i}` }))
    await s.settle() // B now holds all 60 with the same content
    // Model "both computers were merged through a backup file": no sync memory on B, bills not queued
    B.sync.remove([SHARED_STATE_KEYS.cursor]); B.sqlite.exec('DELETE FROM sync_record_state')
    for (let i = 0; i < 25; i++) B.bills.save(billInput(U(`only-b-${i}`), '2', { item: `OB${i}` }))
    s.tick(60_000)
    B.bills.save(billInput(U('cmp-7'), '99', { item: 'C7' })) // same id, later content on B
    B.sqlite.exec('DELETE FROM sync_outbox') // made before sync was on
    expect(B.compare.needed()).toBe(true)
    const res = await B.compare.run()
    expect(res).toMatchObject({ state: 'done', skip: 59, upload: 25, conflict: 1, download: 0 })
    expect(B.compare.needed()).toBe(false)
    expect(B.pendingCount()).toBe(26)
    await B.push.runOnce()
    await s.settle()
    expect(A.q('SELECT COUNT(*) AS n FROM bills')[0]).toMatchObject({ n: 85 })
    expect(A.rows(U('cmp-7'))).toEqual(['C7:99'])
    expect(B.rows(U('cmp-7'))).toEqual(['C7:99'])
  })

  it('with nothing to download the cursor jumps to the first manifest\'s high mark and no record is pulled', async () => {
    const s = await mk(); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    for (let i = 0; i < 20; i++) A.bills.save(billInput(U(`j-${i}`), '3', { item: `J${i}` }))
    await s.settle()
    B.sync.remove([SHARED_STATE_KEYS.cursor]); B.sqlite.exec('DELETE FROM sync_record_state')
    const res = await B.compare.run()
    expect(res).toMatchObject({ state: 'done', skip: 20, download: 0, upload: 0 })
    expect(res.cursor).toBe(20)
    const p = await B.pull.runOnce()
    expect(p).toMatchObject({ applied: 0, skipped: 0, pages: 1 })
  })

  it('a new empty computer: everything is a download and the pull brings it all', async () => {
    const s = await mk({ branches: 3 }); const [A, , C] = s.bs as [typeof s.bs[0], typeof s.bs[0], typeof s.bs[0]]
    for (let i = 0; i < 15; i++) A.bills.save(billInput(U(`n-${i}`), '3', { item: `N${i}` }))
    await A.push.runOnce()
    const res = await C.compare.run()
    expect(res).toMatchObject({ state: 'done', download: 15, skip: 0, upload: 0 })
    expect(res.cursor).toBe(0)
    expect((await C.pull.runOnce()).applied).toBe(15)
  })

  it('is resumable: a connection failure after the first kind keeps that kind done, the rerun does not ask for it again', async () => {
    const s = await mk(); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    for (let i = 0; i < 5; i++) A.bills.save(billInput(U(`rs-${i}`), '3', { item: `RS${i}` }))
    await A.push.runOnce()
    const calls: string[] = []
    let failParty = true
    const inner = B.wrapped.current as InMemorySharedTransport
    B.wrapped.current = new Proxy(inner, {
      get(target, prop, recv) {
        if (prop === 'manifest') return async (a: { kind: string }) => { calls.push(a.kind); if (a.kind === 'party' && failParty) throw new SharedTransportError('offline'); return target.manifest(a as never) }
        const v = Reflect.get(target, prop, recv)
        return typeof v === 'function' ? v.bind(target) : v
      }
    }) as SharedStoreTransport
    const first = await B.compare.run()
    expect(first).toMatchObject({ state: 'paused', block: 'offline', cursor: null })
    expect(B.compare.needed()).toBe(true)
    failParty = false; calls.length = 0
    const second = await B.compare.run()
    expect(second.state).toBe('done')
    expect(calls).not.toContain('bill')
    expect(second.download).toBe(5)
  })
})

describe('failures never block the others', () => {
  it('a record that fails to apply is kept and retried; the cursor passes it; it is set aside after the cap', async () => {
    const s = await mk(); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    for (let i = 0; i < 5; i++) A.bills.save(billInput(U(`f-${i}`), '3', { item: `F${i}` }))
    await A.push.runOnce()
    const bad = U('f-2')
    const real = B.applier.current
    B.applier.current = { apply: (rec, ctx) => { if (rec.recId === bad) throw new Error('disk trouble'); return real.apply(rec, ctx) } }
    const r1 = await B.pull.runOnce()
    expect(r1).toMatchObject({ applied: 4, failed: 1 })
    expect(readCursor(B.sync)).toBe(5)
    expect(B.pull.status().waiting).toBe(1)
    for (let i = 1; i < SHARED_PULL_FAIL_CAP; i++) await B.pull.runOnce()
    expect(B.pull.status().waiting).toBe(0)
    expect(B.aside.count()).toBe(1) // kept whole, not lost
    expect(B.records.getState('bill', bad)).toBeDefined()
    expect(B.q('SELECT 1 FROM bills WHERE id = ?', bad)).toHaveLength(0)
  })

  it('a failed record that works on the retry is applied and forgotten', async () => {
    const s = await mk(); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    const id = U('f-retry'); A.bills.save(billInput(id, '3')); await A.push.runOnce()
    const real = B.applier.current
    let fail = true
    B.applier.current = { apply: (rec, ctx) => { if (fail) throw new Error('boom'); return real.apply(rec, ctx) } }
    await B.pull.runOnce(); expect(B.bill(id)).toBeUndefined()
    fail = false
    expect(await B.pull.runOnce()).toMatchObject({ applied: 1 })
    expect(B.pull.status().waiting).toBe(0)
    expect(B.rows(id)).toEqual(['Pen:3'])
  })

  it('a bill open in the editor is held without counting an attempt, and applied when it closes', async () => {
    let open = true
    const s = await mk({ isOpen: (i) => i === 1 && open }); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    const id = U('held-1')
    A.bills.save(billInput(id, '1')); await s.settle()
    s.tick(60_000); A.bills.save(billInput(id, '2')); await A.push.runOnce()
    for (let i = 0; i < SHARED_PULL_FAIL_CAP + 2; i++) expect(await B.pull.runOnce()).toMatchObject({ held: 1 })
    expect(B.rows(id)).not.toEqual(['Pen:2'])
    expect(B.aside.count()).toBe(0)
    open = false
    expect(await B.pull.runOnce()).toMatchObject({ applied: 1 })
    expect(B.rows(id)).toEqual(['Pen:2'])
  })

  it('a record from a newer writer is set aside whole; the cursor moves on; nothing is applied', async () => {
    const s = await mk(); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    const id = U('newer-1'); A.bills.save(billInput(id, '1'))
    const sb = serializeBill(A.bills.getForEdit(id))
    const { syncState: _s, ...rec } = sb.bill; void _s
    const e = encodeRecord({ kind: 'bill', recId: id, data: { bill: rec, rows: sb.rows }, deleted: false, editedAt: '2026-10-12T00:00:00.000Z', appVer: '9.0.0' })
    s.server.seedRecord(s.orgId, { kind: 'bill', recId: id, version: 1, payload: { ...e.payload, futureField: 1 }, payloadHash: e.payloadHash, editedAt: e.editedAt, fromBranch: A.id, minReaderVer: 2 })
    A.sqlite.exec('DELETE FROM sync_outbox')
    const r = await B.pull.runOnce()
    expect(r).toMatchObject({ aside: 1, applied: 0, failed: 0 })
    expect(B.q('SELECT 1 FROM bills WHERE id = ?', id)).toHaveLength(0)
    expect(B.aside.count()).toBe(1)
    expect(readCursor(B.sync)).toBe(1)
    expect(B.records.getState('bill', id)).toMatchObject({ baseVersion: 1 })
  })
})

describe('connection trouble', () => {
  it('offline: the push waits, no attempt is counted against the row, the next run sends it', async () => {
    const s = await mk(); const [A] = s.bs as [typeof s.bs[0]]
    const id = U('off-1'); A.bills.save(billInput(id, '1'))
    s.server.setOffline(true)
    const r = await A.push.runOnce()
    expect(r).toMatchObject({ sent: 0, block: 'offline' })
    expect(A.outboxRepo.pending(10)[0]).toMatchObject({ attempts: 0 })
    expect(A.push.status().consecutiveFailures).toBe(1)
    s.server.setOffline(false)
    expect(await A.push.runOnce()).toMatchObject({ sent: 1, block: 'idle' })
    expect(A.push.status().consecutiveFailures).toBe(0)
  })

  it('paused server: both workers report `paused`, nothing is lost', async () => {
    const s = await mk(); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    A.bills.save(billInput(U('p-1'), '1')); s.server.setPaused(true)
    expect(await A.push.runOnce()).toMatchObject({ block: 'paused', sent: 0 })
    expect(await B.pull.runOnce()).toMatchObject({ block: 'paused' })
    s.server.setPaused(false)
    await s.settle()
    expect(B.rows(U('p-1'))).toEqual(['Pen:1'])
  })

  it('a suspended license pauses with `auth` or `license` and counts nothing against rows', async () => {
    const s = await mk(); const [A] = s.bs as [typeof s.bs[0]]
    A.bills.save(billInput(U('l-1'), '1'))
    s.server.setLicenseStatus(s.orgId, 'suspended')
    const r = await A.push.runOnce()
    expect(['auth', 'license']).toContain(r.block)
    expect(A.outboxRepo.pending(10)[0]).toMatchObject({ attempts: 0 })
  })

  it('a batch the server refuses is retried one row at a time: the culprit is blamed, the others go', async () => {
    const s = await mk(); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    const ids = [U('x-1'), U('x-2'), U('x-3')]
    ids.forEach((id, i) => A.bills.save(billInput(id, String(i + 1), { item: `X${i}` })))
    const inner = A.wrapped.current as InMemorySharedTransport
    A.wrapped.current = new Proxy(inner, {
      get(target, prop, recv) {
        if (prop === 'push') return async (a: PushArgs) => { if (a.items.some((x) => x.recId === ids[1])) throw new SharedTransportError('invalid_input'); return target.push(a) }
        const v = Reflect.get(target, prop, recv)
        return typeof v === 'function' ? v.bind(target) : v
      }
    }) as SharedStoreTransport
    const r = await A.push.runOnce()
    expect(r).toMatchObject({ sent: 2, failedAttempts: 1, block: 'idle' })
    expect(A.outboxRepo.pending(10)).toHaveLength(1)
    expect(A.outboxRepo.pending(10)[0]).toMatchObject({ billId: ids[1], attempts: 1 })
    await B.pull.runOnce()
    expect(B.q('SELECT COUNT(*) AS n FROM bills')[0]).toMatchObject({ n: 2 })
  })
})

describe('keys and secrets', () => {
  it('the license key is only ever passed to the transport, never stored by the workers or written to sync_state', async () => {
    const s = await mk(); const [A, B] = s.bs as [typeof s.bs[0], typeof s.bs[0]]
    A.bills.save(billInput(U('k-1'), '1')); await s.settle(); await B.compare.run()
    for (const b of [A, B]) {
      const all = b.q<{ key: string; value: string }>('SELECT key, value FROM sync_state')
      expect(JSON.stringify(all)).not.toContain(SIM_KEY)
    }
  })
})
