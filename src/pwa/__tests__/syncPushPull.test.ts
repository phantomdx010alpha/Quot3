import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import '../../shared/format'
import { createEmptyBill, serializeBill } from '../../shared/billModel'
import { row } from '../../shared/__fixtures__/bills'
import { encodeRecord } from '../../shared/sync/codecV2'
import { InMemorySharedServer, InMemorySharedTransport, SharedTransportError } from '../../main/sync/sharedTransport'
import { openPhoneDb, putRecord, reqToPromise, txDone, type PhoneDb } from '../data/db'
import { deleteBills, getBill, listBillHeads, listRevisions, restoreBills, saveBill, type SaveBillInput } from '../data/billsRepo'
import { getMetaValue } from '../data/metaRepo'
import { listPartyRecords, saveBillWithParty } from '../data/partiesRepo'
import { asideEnvelopeJson } from '../../shared/sync/codecV2'
import { countAside, putAsideTx } from '../sync/aside'
import { billRecordOf, encodeLocal, listLocalHashes } from '../sync/encode'
import { createPhoneConnect } from '../sync/connect'
import { createPhoneDoorbell } from '../sync/doorbell'
import { createPhoneSyncEngine, type PhoneSyncEngine } from '../sync/engine'
import { linkPhoneToOrganisation } from '../sync/branch'
import { captureInTx, listPending, outboxCounts, settleTx, withOutbox } from '../sync/outbox'
import { getState } from '../sync/recordState'
import { createSessionVault } from '../sync/session'
import { readCursor, SYNC_META, getRaw } from '../sync/syncMeta'
import { createPhonePullWorker, type PullRunResult } from '../sync/pull'
import { createPhonePushWorker, type PushRunResult } from '../sync/push'
import type { PhoneSharedPort } from '../sync/transport'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange

const LICENSE = 'Q3-ABCD-EFGH-JKLM'
const T0 = Date.parse('2026-10-21T10:00:00.000Z')
const APP = '0.1.20'
const uuid = (): string => globalThis.crypto.randomUUID()

interface World { server: InMemorySharedServer; orgId: string; seats: { email: string; password: string }[]; at(ms: number): void; now(): number }
function world(seats = 4): World {
  let clock = T0
  const server = new InMemorySharedServer({ now: () => clock })
  const list = Array.from({ length: seats }, (_, i) => ({ email: `seat${i + 1}@example.test`, password: `pw-${i + 1}-secret` }))
  const { orgId } = server.addOrg({ licenseKey: LICENSE, seats: list })
  return { server, orgId, seats: list, at: (ms) => { clock = T0 + ms }, now: () => clock }
}

interface Peer { db: PhoneDb; port: InMemorySharedTransport; engine: PhoneSyncEngine; branchId: string; open: Set<string>; changed: string[]; save(i: SaveBillInput): Promise<{ id: string }>; setPort(p: PhoneSharedPort): void; pullOnly(): Promise<PullRunResult>; pushOnly(): Promise<PushRunResult> }

async function peer(w: World, seat: number, prefix: string, o: { link?: boolean; wrap?: (p: InMemorySharedTransport) => PhoneSharedPort; timers?: unknown[] } = {}): Promise<Peer> {
  const db = await openPhoneDb({ factory: new IDBFactory() })
  const port = new InMemorySharedTransport(w.server)
  const vault = createSessionVault(db)
  const s = w.seats[seat - 1] as { email: string; password: string }
  const r = await linkPhoneToOrganisation(db, port, vault, { supabaseUrl: 'https://example-project.supabase.co', anonKey: 'invented-anon', licenseKey: LICENSE, email: s.email, password: s.password, branchName: `Phone ${prefix}`, poPrefix: prefix }, w.now)
  expect(r.ok).toBe(true)
  const base: PhoneSharedPort = o.wrap ? o.wrap(port) : port
  let current: PhoneSharedPort = base
  const connect = createPhoneConnect(db, vault, port)
  const open = new Set<string>()
  const changed: string[] = []
  const engine = createPhoneSyncEngine({
    db, appVer: APP, now: () => new Date(w.now()), setTimer: (fn) => { o.timers?.push(fn); return 0 }, clearTimer: () => undefined,
    env: { onVisible: () => () => undefined, onOnline: () => () => undefined },
    isOpen: (id) => open.has(id), onChanged: (k, id) => changed.push(`${k}:${id}`),
    connect: async () => { const c = await connect.connect(); return { port: current, creds: c.creds } }
  })
  const branchId = (await getMetaValue(db, 'branch_id')) as string
  const conn = async () => { const c = await connect.connect(); return { port: current, creds: c.creds } }
  const timers = { setTimer: () => 0, clearTimer: () => undefined, now: () => new Date(w.now()) }
  return {
    db, port, engine, branchId, open, changed, setPort: (p) => { current = p },
    pullOnly: () => createPhonePullWorker({ db, connect: conn, appVer: APP, newId: uuid, isOpen: (id) => open.has(id) }, timers).runOnce(),
    pushOnly: () => createPhonePushWorker({ db, connect: conn, appVer: APP }, timers).runOnce(),
    save: (i) => saveBillWithParty(db, i, { ...withOutbox({ now: () => new Date(w.now()) }), now: () => new Date(w.now()) })
  }
}

let n = 0
function input(over: { id?: string; name?: string; qty?: string; rate?: string; date?: string } = {}): SaveBillInput {
  const b = createEmptyBill({ branchId: 'x', formatId: 'non_gst', billDate: over.date ?? '2026-10-21' })
  return {
    bill: { id: over.id ?? uuid(), party: { name: over.name ?? 'Test Party', phone: '', address: '', transport: '' }, formatId: b.formatId, extraCols: [], paperOverride: null, billDate: b.billDate, rows: [row('widget', over.qty ?? '2', over.rate ?? '50')] }
  }
}
/** A re-save of an existing bill with a different quantity (a "later edit"). */
async function edit(p: Peer, id: string, qty: string): Promise<void> {
  const cur = await getBill(p.db, id)
  await p.save({ bill: { id, party: cur.party, formatId: cur.formatId, extraCols: cur.extraCols, paperOverride: cur.paperOverride, billDate: cur.billDate, rows: cur.rows.map((r, i) => (i === 0 ? { ...r, qty } : r)) }, partyId: cur.partyId })
}
const qtyOf = async (p: Peer, id: string): Promise<string | null> => (await getBill(p.db, id)).rows[0]?.qty ?? null

async function firstSync(p: Peer, scope: { mode: 'all' } | { mode: 'recent'; billLimit: number } = { mode: 'all' }) {
  const prev = await p.engine.prepareFirstSync()
  const res = await p.engine.completeFirstSync(prev, scope)
  return { prev, res }
}

/** The desktop side: another seat on the server that writes bills straight through the shared codec (no phone code). */
async function desktop(w: World, seat: number) {
  const port = new InMemorySharedTransport(w.server)
  const s = w.seats[seat - 1] as { email: string; password: string }
  await port.signIn(s)
  const branchId = uuid()
  await port.activate({ license: LICENSE, branchId, name: 'Office PC', poPrefix: 'PC', device: 'test', takeover: false })
  let poSeq = 0
  return {
    branchId,
    async pushBill(o: { id?: string; name?: string; qty?: string; deleted?: boolean; editedAtMs?: number; baseVersion?: number } = {}): Promise<string> {
      const id = o.id ?? uuid()
      const at = new Date(o.editedAtMs ?? w.now()).toISOString()
      const b = createEmptyBill({ branchId, formatId: 'non_gst', billDate: '2026-10-21', now: at })
      const bill = { ...b, id, poSeq: ++poSeq, poNumber: `PC-${poSeq}`, party: { name: o.name ?? 'Desk Party', phone: '', address: '', transport: '' }, rows: [row('desk item', o.qty ?? '3', '10')], deletedAt: o.deleted ? at : null }
      const ser = serializeBill(bill)
      const enc = encodeRecord({ kind: 'bill', recId: id, data: { bill: ser.bill, rows: ser.rows }, deleted: o.deleted === true, editedAt: at, appVer: 'desk' })
      const [res] = await port.push({ license: LICENSE, branchId, items: [{ ...enc, baseVersion: o.baseVersion ?? 0 }] })
      expect(res).toBeTruthy()
      return id
    }
  }
}

/** Every local bill / customer hash equals the server's (the whole point of convergence). */
async function expectConverged(w: World, ...peers: Peer[]): Promise<void> {
  for (const p of peers) {
    const off = null
    for (const kind of ['bill', 'party'] as const) {
      const local = new Map((await listLocalHashes(p.db, kind, { offsetMs: off, appVer: APP })).map((l) => [l.recId, l.hash]))
      for (const rec of w.server.records(w.orgId).filter((r) => r.kind === kind)) expect(local.get(rec.recId), `${kind} ${rec.recId}`).toBe(rec.payloadHash)
    }
  }
}

describe('N-branch convergence', () => {
  it('two phones and a desktop converge, customers go before bills, payload has no phone index fields', async () => {
    const w = world()
    const a = await peer(w, 1, 'PA')
    const b = await peer(w, 2, 'PB')
    const d = await desktop(w, 3)
    await firstSync(a)
    await firstSync(b)
    const billA = (await a.save(input({ name: 'Alpha Traders', qty: '4' }))).id
    expect((await outboxCounts(a.db)).pending).toBe(2)
    expect((await listPending(a.db)).map((r) => r.kind)).toEqual(['party', 'bill'])
    await a.engine.syncNow()
    expect((await outboxCounts(a.db)).pending).toBe(0)
    const recs = w.server.records(w.orgId)
    const party = recs.find((r) => r.kind === 'party')!
    const bill = recs.find((r) => r.kind === 'bill')!
    expect(party.serverSeq).toBeLessThan(bill.serverSeq)
    const bp = bill.payload as { bill: Record<string, unknown>; rows: Record<string, unknown>[] }
    for (const k of ['bill_date', 'party_id', 'po_number', 'deleted_at', 'syncState']) expect(bp.bill).not.toHaveProperty(k)
    for (const r of bp.rows) expect(r).not.toHaveProperty('bill_id')
    expect(party.payload.party as object).not.toHaveProperty('name_norm')

    const billD = await d.pushBill({ name: 'Delta Stores' })
    await b.engine.syncNow()
    await a.engine.syncNow()
    expect(await qtyOf(b, billA)).toBe('4')
    expect(await qtyOf(a, billD)).toBe('3')
    expect(await qtyOf(b, billD)).toBe('3')
    expect((await listPartyRecords(b.db)).map((p) => p.name).sort()).toEqual(['Alpha Traders', 'Delta Stores'])
    await expectConverged(w, a, b)
    expect(b.changed.some((c) => c === `bill:${billA}`)).toBe(true)
    // a second run changes nothing and sends nothing
    const again = await a.engine.syncNow()
    expect(again.push.sent).toBe(0)
    expect(again.pull.applied).toBe(0)
  })

  it('a phone never gets its own record back as a change', async () => {
    const w = world()
    const a = await peer(w, 1, 'PA')
    await firstSync(a)
    const id = (await a.save(input())).id
    await a.engine.syncNow()
    const r = await a.engine.syncNow()
    expect(r.pull.applied).toBe(0)
    expect((await getBill(a.db, id)).revision).toBe(1)
  })
})

describe('conflicts (latest edit wins, the loser is kept)', () => {
  async function pair() {
    const w = world()
    const a = await peer(w, 1, 'PA')
    const b = await peer(w, 2, 'PB')
    await firstSync(a)
    await firstSync(b)
    w.at(1000)
    const id = (await a.save(input({ qty: '1' }))).id
    await a.engine.syncNow()
    await b.engine.syncNow()
    return { w, a, b, id }
  }

  it('B edits later and syncs LAST: B wins on the server, A gets it, A\'s version stays in history', async () => {
    const { w, a, b, id } = await pair()
    w.at(5000); await edit(a, id, '10')
    w.at(9000); await edit(b, id, '20')
    await a.engine.syncNow()
    const r = await b.engine.syncNow()
    expect(r.push.won).toBe(1)
    await a.engine.syncNow()
    expect(await qtyOf(a, id)).toBe('20')
    expect(await qtyOf(b, id)).toBe('20')
    expect(w.server.historyOf(w.orgId, 'bill', id).some((h) => h.reason === 'conflict_loser')).toBe(true)
    await expectConverged(w, a, b)
  })

  it('B edits later but syncs FIRST: A\'s older push loses, the winner reaches A, A\'s version is kept locally', async () => {
    const { w, a, b, id } = await pair()
    w.at(5000); await edit(a, id, '10')
    w.at(9000); await edit(b, id, '20')
    await b.engine.syncNow()
    // A pulls first: its unsent change is OLDER, so it loses and stays in the revision list
    const r = await a.engine.syncNow()
    expect(r.pull.applied).toBeGreaterThan(0)
    expect(await qtyOf(a, id)).toBe('20')
    const revs = await listRevisions(a.db, id)
    expect(revs.some((x) => (JSON.parse(x.snapshot_json) as { rows: { qty: string }[] }).rows[0]?.qty === '10')).toBe(true)
    expect((await outboxCounts(a.db)).pending).toBe(0)
    await expectConverged(w, a, b)
  })

  it('A\'s unsent edit is LATER than what it pulls: local wins (kept_local), the next push is accepted and the older one is kept on the server', async () => {
    const { w, a, b, id } = await pair()
    w.at(5000); await edit(b, id, '20')
    await b.engine.syncNow()
    w.at(9000); await edit(a, id, '10')
    const pulled = await a.pullOnly()
    expect(pulled.keptLocal).toBe(1)
    expect(await qtyOf(a, id)).toBe('10')
    const pushed = await a.pushOnly()
    expect(pushed.sent).toBe(1)
    expect(pushed.accepted + pushed.won).toBe(1)
    expect(pushed.lost).toBe(0)
    expect(w.server.historyOf(w.orgId, 'bill', id).length).toBeGreaterThan(0)
    await b.engine.syncNow()
    expect(await qtyOf(b, id)).toBe('10')
    await expectConverged(w, a, b)
  })

  it('a delete on one phone arrives as a tombstone and a restore brings the bill back', async () => {
    const { w, a, b, id } = await pair()
    w.at(3000)
    await deleteBills(a.db, [id], { ...withOutbox({ now: () => new Date(w.now()) }), now: () => new Date(w.now()) })
    await a.engine.syncNow()
    await b.engine.syncNow()
    expect((await listBillHeads(b.db, { trashed: true })).map((h) => h.id)).toContain(id)
    expect((await listBillHeads(b.db)).map((h) => h.id)).not.toContain(id)
    w.at(6000)
    await restoreBills(a.db, [id], { ...withOutbox({ now: () => new Date(w.now()) }), now: () => new Date(w.now()) })
    await a.engine.syncNow()
    await b.engine.syncNow()
    expect((await listBillHeads(b.db)).map((h) => h.id)).toContain(id)
    await expectConverged(w, a, b)
  })
})

describe('aside (a newer app wrote it)', () => {
  it('keeps the record whole, moves the cursor on, and applies it after an update (atomic retry)', async () => {
    const w = world()
    const a = await peer(w, 1, 'PA')
    await firstSync(a)
    // a record written by a NEWER app: min_reader_ver 2
    const dskId = uuid()
    const at = new Date(w.now()).toISOString()
    const b0 = createEmptyBill({ branchId: 'dsk', formatId: 'non_gst', billDate: '2026-10-21', now: at })
    const ser = serializeBill({ ...b0, id: dskId, poSeq: 1, poNumber: 'PC-1', party: { name: 'Future Party', phone: '', address: '', transport: '' }, rows: [row('future', '1', '5')] })
    const enc = encodeRecord({ kind: 'bill', recId: dskId, data: { bill: ser.bill, rows: ser.rows }, deleted: false, editedAt: at, appVer: 'future', minReaderVer: 2 })
    expect(enc.minReaderVer).toBe(2)
    w.server.seedRecord(w.orgId, { kind: 'bill', recId: dskId, version: 1, payload: enc.payload, payloadHash: enc.payloadHash, editedAt: at, fromBranch: uuid(), schemaVer: enc.schemaVer, minReaderVer: 2, appVer: 'future' })
    const r = await a.engine.syncNow()
    expect(r.pull.aside).toBe(1)
    expect((await readCursor(a.db))).toBeGreaterThan(0)
    expect(await countAside(a.db)).toEqual({ total: 1, bills: 1 })
    expect((await listBillHeads(a.db)).length).toBe(0)
    // a pull of the same record again never overwrites it, and a retry with the OLD reader changes nothing
    const still = await a.engine.retryAside(1)
    expect(still).toMatchObject({ retried: 1, applied: 0, stillAside: 1 })
    expect(await countAside(a.db)).toEqual({ total: 1, bills: 1 })
    // after the "update" (reader version 2) it is applied, remembered and removed in one step
    const done = await a.engine.retryAside(2)
    expect(done).toMatchObject({ retried: 1, applied: 1, stillAside: 0, failed: 0 })
    expect(await countAside(a.db)).toEqual({ total: 0, bills: 0 })
    expect((await listBillHeads(a.db)).map((h) => h.id)).toEqual([dskId])
    expect((await getState(a.db, 'bill', dskId))?.baseVersion).toBe(1)
    // nothing is queued for sending (it came from the notebook)
    expect((await outboxCounts(a.db)).pending).toBe(0)
  })

  it('a record that cannot be applied stays aside and rolls back completely', async () => {
    const w = world()
    const a = await peer(w, 1, 'PA')
    await firstSync(a)
    const id = uuid()
    const at = new Date(w.now()).toISOString()
    // an envelope that decodes (reader 2) but whose bill id disagrees with the record id: the applier throws
    const b0 = createEmptyBill({ branchId: 'dsk', formatId: 'non_gst', billDate: '2026-10-21', now: at })
    const ser = serializeBill({ ...b0, id: uuid(), poSeq: 1, poNumber: 'PC-1', party: { name: 'Odd Party', phone: '', address: '', transport: '' }, rows: [row('odd', '1', '5')] })
    const enc = encodeRecord({ kind: 'bill', recId: id, data: { bill: ser.bill, rows: ser.rows }, deleted: false, editedAt: at, appVer: 'future', minReaderVer: 2 })
    const raw = { kind: 'bill', recId: id, version: 1, serverSeq: 1, payload: enc.payload, schemaVer: enc.schemaVer, minReaderVer: 2, appVer: 'future', editedAt: at, deleted: false }
    const tx = a.db.idb.transaction(['sync_aside'], 'readwrite')
    await putAsideTx(tx, { kind: 'bill', recId: id, version: 1, minReaderVer: 2, payloadJson: asideEnvelopeJson(raw), seenAt: at })
    await txDone(tx)
    const r = await a.engine.retryAside(2)
    expect(r.failed).toBe(1)
    expect(r.applied).toBe(0)
    expect(await countAside(a.db)).toEqual({ total: 1, bills: 1 })
    expect((await listBillHeads(a.db)).length).toBe(0)
    expect(await getState(a.db, 'bill', id)).toBeUndefined()
  })
})

/** A hostile network around a port: the request is lost before the server sees it, or the answer is lost after the server did the work. */
function flaky(port: InMemorySharedTransport, rand: () => number, p: { before: number; after: number }, on: () => { before: number; after: number } = () => p): PhoneSharedPort {
  const lossy = new Set(['push', 'pull', 'manifest'])
  return new Proxy(port as unknown as PhoneSharedPort, {
    get(target, prop, recv) {
      const v = Reflect.get(target as object, prop, recv) as unknown
      if (typeof prop !== 'string' || !lossy.has(prop) || typeof v !== 'function') return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
      return async (...args: unknown[]) => {
        const { before, after } = on()
        if (rand() < before) throw new SharedTransportError('offline')
        const out = await (v as (...a: unknown[]) => Promise<unknown>).apply(target, args)
        if (rand() < after) throw new SharedTransportError('offline')
        return out
      }
    }
  })
}
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000 }
}

describe('hostile network', () => {
  it('lost requests and lost answers never lose or duplicate a record, and never blame a row', async () => {
    const w = world()
    const rate = { before: 0.3, after: 0.3 }
    const rand = seeded(179)
    const a = await peer(w, 1, 'PA', { wrap: (p) => flaky(p, rand, rate, () => rate) })
    const b = await peer(w, 2, 'PB', { wrap: (p) => flaky(p, rand, rate, () => rate) })
    const d = await desktop(w, 3)
    // first sync happens on a clean network (it is a deliberate, watched step); the traffic after it is lossy
    rate.before = 0; rate.after = 0
    await firstSync(a)
    await firstSync(b)
    rate.before = 0.3; rate.after = 0.3
    const ids: string[] = []
    for (let i = 0; i < 6; i++) { w.at(1000 * (i + 1)); ids.push((await (i % 2 ? a : b).save(input({ name: `Party ${i}`, qty: String(i + 1) }))).id) }
    for (let i = 0; i < 3; i++) ids.push(await d.pushBill({ name: `Desk ${i}` }))
    w.at(20000)
    await edit(a, ids[1] as string, '77')
    for (let i = 0; i < 25; i++) { await a.engine.syncNow(); await b.engine.syncNow() }
    rate.before = 0; rate.after = 0
    for (let i = 0; i < 3; i++) { await a.engine.syncNow(); await b.engine.syncNow() }
    expect(await outboxCounts(a.db)).toEqual({ pending: 0, failed: 0 })
    expect(await outboxCounts(b.db)).toEqual({ pending: 0, failed: 0 })
    expect((await listBillHeads(a.db)).length).toBe(9)
    expect((await listBillHeads(b.db)).length).toBe(9)
    // one server record per bill (a retried push is a noop, not a duplicate)
    expect(w.server.records(w.orgId).filter((r) => r.kind === 'bill').length).toBe(9)
    await expectConverged(w, a, b)
  })

  it('a server that is offline pauses the workers and never counts against a row', async () => {
    const w = world()
    const a = await peer(w, 1, 'PA')
    await firstSync(a)
    const id = (await a.save(input())).id
    w.server.setOffline(true)
    const r = await a.engine.syncNow()
    expect(r.push.block).not.toBe('idle')
    expect(r.push.sent).toBe(0)
    const pending = await listPending(a.db)
    expect(pending.length).toBe(2)
    expect(pending.every((x) => x.attempts === 0 && x.state === 'pending')).toBe(true)
    w.server.setOffline(false)
    await a.engine.syncNow()
    expect((await outboxCounts(a.db)).pending).toBe(0)
    expect(w.server.record(w.orgId, 'bill', id)).toBeTruthy()
  })
})

describe('a bill open in the editor is held', () => {
  it('is not changed under the editor, and is applied once it is closed', async () => {
    const w = world()
    const a = await peer(w, 1, 'PA')
    const b = await peer(w, 2, 'PB')
    await firstSync(a)
    await firstSync(b)
    w.at(1000)
    const id = (await a.save(input({ qty: '1' }))).id
    await a.engine.syncNow()
    await b.engine.syncNow()
    w.at(5000); await edit(a, id, '9')
    await a.engine.syncNow()
    b.open.add(id)
    const held = await b.pullOnly()
    expect(held.held).toBe(1)
    expect(await qtyOf(b, id)).toBe('1')
    b.open.delete(id)
    const done = await b.pullOnly()
    expect(await qtyOf(b, id)).toBe('9')
    expect(done.held).toBe(0)
  })
})

describe('outbox rules', () => {
  it('a newer change replaces the row (n counts) and a settle for an older n leaves it', async () => {
    const w = world()
    const a = await peer(w, 1, 'PA')
    await firstSync(a)
    const id = (await a.save(input({ qty: '1' }))).id
    w.at(2000); await edit(a, id, '2')
    const rows = (await listPending(a.db)).filter((r) => r.kind === 'bill')
    expect(rows.length).toBe(1)
    expect(rows[0]!.n).toBe(2)
    let tx = a.db.idb.transaction('sync_outbox', 'readwrite')
    await settleTx(tx, { id: rows[0]!.id, n: 1 })
    await txDone(tx)
    expect((await listPending(a.db)).filter((r) => r.kind === 'bill').length).toBe(1)
    tx = a.db.idb.transaction('sync_outbox', 'readwrite')
    await settleTx(tx, { id: rows[0]!.id, n: 2 })
    await txDone(tx)
    expect((await listPending(a.db)).filter((r) => r.kind === 'bill').length).toBe(0)
  })

  it('a save that fails rolls the outbox row back with it', async () => {
    const w = world()
    const a = await peer(w, 1, 'PA')
    const before = await outboxCounts(a.db)
    await expect(saveBill(a.db, input({ name: '' }), { inTx: (tx) => captureInTx(tx, { kind: 'bill', recId: 'x', op: 'upsert', revision: 1 }, new Date().toISOString()) })).rejects.toBeTruthy()
    expect(await outboxCounts(a.db)).toEqual(before)
  })
})

describe('first sync', () => {
  async function seeded3(w: World, count: number): Promise<string[]> {
    const d = await desktop(w, 3)
    const ids: string[] = []
    for (let i = 0; i < count; i++) ids.push(await d.pushBill({ name: `Old ${i}`, qty: String(i + 1) }))
    return ids
  }

  it('"all": downloads everything, uploads bills made before the first sync, and starts the workers', async () => {
    const w = world()
    const server = await seeded3(w, 4)
    const a = await peer(w, 1, 'PA')
    expect(await a.engine.start()).toBe('first_sync_needed')
    const mine = (await a.save(input({ name: 'Before Link' }))).id
    const { prev } = await firstSync(a)
    expect(prev.totals).toBeTruthy()
    expect(prev.assessment.downloadBills).toBe(4)
    expect(a.engine.state()).toBe('running')
    await a.engine.syncNow()
    expect((await listBillHeads(a.db)).length).toBe(5)
    expect(w.server.record(w.orgId, 'bill', mine)).toBeTruthy()
    for (const id of server) expect(await qtyOf(a, id)).not.toBeNull()
    await expectConverged(w, a)
    expect(await a.engine.start()).toBe('running')
  })

  it('"recent": stores only the newest bills + all customers, counts the rest, and "load older bills" fetches them', async () => {
    const w = world()
    const ids = await seeded3(w, 6)
    const a = await peer(w, 1, 'PA')
    await firstSync(a, { mode: 'recent', billLimit: 2 })
    await a.engine.syncNow()
    const have = new Set((await listBillHeads(a.db)).map((h) => h.id))
    expect(have.size).toBe(2)
    expect(have.has(ids[5] as string) && have.has(ids[4] as string)).toBe(true)
    expect((await listPartyRecords(a.db)).length).toBeGreaterThanOrEqual(2)
    expect((await a.engine.status()).deferredBills).toBe(4)
    await a.engine.loadOlderBills()
    await a.engine.syncNow()
    expect((await listBillHeads(a.db)).length).toBe(6)
    expect((await a.engine.status()).deferredBills).toBe(0)
    expect(await getRaw(a.db, SYNC_META.floorSeq, 0)).toBe(0)
    await expectConverged(w, a)
  })

  it('the compare writes nothing, and the workers do not run before the first sync', async () => {
    const w = world()
    await seeded3(w, 2)
    const a = await peer(w, 1, 'PA')
    await a.engine.prepareFirstSync()
    expect((await listBillHeads(a.db)).length).toBe(0)
    expect(await readCursor(a.db)).toBe(0)
    expect(await a.engine.start()).toBe('first_sync_needed')
  })
})

describe('doorbell', () => {
  function manual() {
    const q: { fn: () => void; ms: number; id: number }[] = []
    let id = 0
    return {
      q,
      setTimer: (fn: () => void, ms: number) => { q.push({ fn, ms, id: ++id }); return id },
      clearTimer: (h: unknown) => { const i = q.findIndex((x) => x.id === h); if (i >= 0) q.splice(i, 1) },
      fire: () => { const t = q.shift(); t?.fn() }
    }
  }
  it('rings within the debounce become ONE pull kick; a dead socket falls back to polling, reconnects with backoff and kicks once when live again', async () => {
    const t = manual()
    let kicks = 0
    let ring: () => void = () => undefined
    let live: (b: boolean) => void = () => undefined
    let connects = 0
    const bell = createPhoneDoorbell({
      connect: async () => ({ port: { subscribeDoorbell: (_a, onRing, onLive) => { connects++; ring = onRing; live = onLive ?? (() => undefined); onLive?.(true); return () => undefined } } }),
      orgId: () => 'org', kick: () => { kicks++ }
    }, { setTimer: t.setTimer, clearTimer: t.clearTimer })
    bell.start()
    await new Promise((r) => setTimeout(r, 0))
    expect(bell.status().mode).toBe('live')
    ring(); ring(); ring()
    expect(t.q.length).toBe(1)
    t.fire()
    expect(kicks).toBe(2) // 1 from going live (rings may have been missed) + 1 debounced for the three rings
    live(false)
    expect(bell.status().mode).toBe('polling')
    expect(t.q.length).toBe(1)
    expect(t.q[0]!.ms).toBe(2000)
    t.fire() // reconnect attempt
    await new Promise((r) => setTimeout(r, 0))
    expect(connects).toBe(2)
    expect(bell.status().mode).toBe('live')
    expect(kicks).toBe(3) // one kick on the way back up
    bell.stop()
    expect(bell.status().started).toBe(false)
    ring()
    expect(t.q.length).toBe(0)
  })

  it('no organisation yet: nothing is subscribed and it stays on the 60 s poll', async () => {
    const t = manual()
    let subscribed = 0
    const bell = createPhoneDoorbell({ connect: async () => ({ port: { subscribeDoorbell: () => { subscribed++; return () => undefined } } }), orgId: () => null, kick: () => undefined }, { setTimer: t.setTimer, clearTimer: t.clearTimer })
    bell.start()
    await new Promise((r) => setTimeout(r, 0))
    expect(subscribed).toBe(0)
    expect(bell.status().mode).toBe('polling')
    bell.stop()
  })
})

describe('engine', () => {
  it('states: not linked -> first sync needed -> running; a second tab is read-only; notifySaved only schedules work while running', async () => {
    const w = world()
    const timers: (() => void)[] = []
    const db = await openPhoneDb({ factory: new IDBFactory() })
    const engine = createPhoneSyncEngine({ db, appVer: APP, setTimer: (fn) => { timers.push(fn); return 0 }, clearTimer: () => undefined, env: { onVisible: () => () => undefined, onOnline: () => () => undefined }, connect: async () => { throw new Error('not used') } })
    expect(await engine.start()).toBe('not_linked')
    engine.notifySaved()
    expect(timers.length).toBe(0)
    const ro = await openPhoneDb({ factory: new IDBFactory(), writer: { held: false } })
    expect(await createPhoneSyncEngine({ db: ro, appVer: APP, connect: async () => { throw new Error('x') } }).start()).toBe('read_only')
    const a = await peer(w, 1, 'PA', { timers })
    expect(await a.engine.start()).toBe('first_sync_needed')
    await firstSync(a)
    expect(a.engine.state()).toBe('running')
    // run the timers that start() queued (their coalescing flag clears), then a Save must queue new work
    for (const f of timers.splice(0)) f()
    await new Promise((r) => setTimeout(r, 20))
    timers.length = 0
    a.engine.notifySaved()
    expect(timers.length).toBeGreaterThan(0)
    a.engine.stop()
    expect(a.engine.state()).toBe('stopped')
    const st = await a.engine.status()
    expect(st.outbox).toEqual({ pending: 0, failed: 0 })
    expect(st.aside).toEqual({ total: 0, bills: 0 })
  })
})
