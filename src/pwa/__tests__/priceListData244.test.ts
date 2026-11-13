import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { encodeRecord } from '../../shared/sync/codecV2'
import { PRICE_DATA_KEY, type PriceKind } from '../../shared/sync/priceListRecords'
import { InMemorySharedServer, InMemorySharedTransport, SharedTransportError } from '../../main/sync/sharedTransport'
import { DB_NAME, STORE_DEFS_V2, openPhoneDb, putRecord, type PhoneDb } from '../data/db'
import { exportBackup, importBackup } from '../data/backup'
import { hasPriceList, listCategories, listRows, listTabs, listTiers, savePriceRecord, softDeletePrice, type PriceStamp } from '../data/priceListRepo'
import { getMetaValue } from '../data/metaRepo'
import { linkPhoneToOrganisation } from '../sync/branch'
import { createPhoneConnect } from '../sync/connect'
import { listLocalHashes } from '../sync/encode'
import { createPhoneSyncEngine } from '../sync/engine'
import { listPending, withPriceOutbox } from '../sync/outbox'
import { createPhonePullWorker } from '../sync/pull'
import { createPhonePushWorker } from '../sync/push'
import { createSessionVault } from '../sync/session'
import type { PhoneSharedPort } from '../sync/transport'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange

// Phase 244 (M23): the phone's Price List data layer. Invented names only; nothing touches a real server or a real phone.
const LICENSE = 'Q3-ABCD-EFGH-JKLM'
const T0 = Date.parse('2026-11-13T10:00:00.000Z')
const APP = '0.1.52'
const ALL = { add: true, edit: true, overwrite: true, delete: true, structure: true }
const uuid = (): string => globalThis.crypto.randomUUID()
const iso = (ms: number): string => new Date(T0 + ms).toISOString()

function world() {
  let clock = T0
  const server = new InMemorySharedServer({ now: () => clock })
  const seats = [1, 2, 3].map((i) => ({ email: `seat${i}@example.test`, password: `pw-${i}-secret` }))
  const { orgId } = server.addOrg({ licenseKey: LICENSE, seats })
  server.setPricePerms(orgId, 2, ALL)
  server.setPricePerms(orgId, 3, ALL)
  return { server, orgId, seats, at: (ms: number) => { clock = T0 + ms }, now: () => clock }
}
type World = ReturnType<typeof world>

async function phone(w: World, seat: number, wrap?: (p: InMemorySharedTransport) => PhoneSharedPort) {
  const db = await openPhoneDb({ factory: new IDBFactory() })
  const port = new InMemorySharedTransport(w.server)
  const vault = createSessionVault(db)
  const s = w.seats[seat - 1] as { email: string; password: string }
  const r = await linkPhoneToOrganisation(db, port, vault, { supabaseUrl: 'https://example-project.supabase.co', anonKey: 'invented-anon', licenseKey: LICENSE, email: s.email, password: s.password, branchName: `Phone ${seat}`, poPrefix: `P${seat}` }, w.now)
  expect(r.ok).toBe(true)
  const connect = createPhoneConnect(db, vault, port)
  const conn = async () => { const c = await connect.connect(); return { port: (wrap ? wrap(port) : port) as PhoneSharedPort, creds: c.creds } }
  const timers = { setTimer: () => 0, clearTimer: () => undefined, now: () => new Date(w.now()) }
  const branchId = (await getMetaValue(db, 'branch_id')) as string
  const engine = createPhoneSyncEngine({
    db, appVer: APP, now: () => new Date(w.now()), setTimer: () => 0, clearTimer: () => undefined, env: { onVisible: () => () => undefined, onOnline: () => () => undefined },
    connect: async () => conn()
  })
  const stamp = (): PriceStamp => ({ at: new Date(w.now()).toISOString(), branchId, seatNo: seat })
  const out = withPriceOutbox({ now: () => new Date(w.now()) })
  return {
    db, branchId, engine,
    pull: () => createPhonePullWorker({ db, connect: conn, appVer: APP, newId: uuid }, timers).runOnce(),
    push: () => createPhonePushWorker({ db, connect: conn, appVer: APP }, timers).runOnce(),
    save: (kind: PriceKind, f: Record<string, unknown> & { id: string }) => savePriceRecord(db, kind, f, stamp(), out),
    del: (kind: PriceKind, id: string) => softDeletePrice(db, kind, id, stamp(), out)
  }
}

/** The PC side: pushes a record straight through the shared codec, exactly the payload the desktop makes. */
async function pc(w: World) {
  const port = new InMemorySharedTransport(w.server)
  await port.signIn(w.seats[0] as { email: string; password: string })
  const branchId = uuid()
  await port.activate({ license: LICENSE, branchId, name: 'Office PC', poPrefix: 'PC', device: 'test', takeover: false })
  const stamps = (atMs: number) => ({ createdAt: iso(0), updatedAt: iso(atMs), deletedAt: null as string | null, branchId })
  const push = async (kind: PriceKind, rec: Record<string, unknown> & { id: string; updatedAt: string; deletedAt: string | null }, baseVersion = 0): Promise<void> => {
    const enc = encodeRecord({ kind, recId: rec.id, data: { [PRICE_DATA_KEY[kind]]: rec }, deleted: rec.deletedAt !== null, editedAt: rec.updatedAt, appVer: 'desk' })
    const [res] = await port.push({ license: LICENSE, branchId, items: [{ ...enc, baseVersion }] })
    expect(res?.outcome === 'accepted' || res?.outcome === 'won' || res?.outcome === 'noop').toBe(true)
  }
  return {
    branchId, push, stamps,
    tier: (id: string, key: string, label: string, position: number, atMs = 1) => push('price_tier', { id, key, label, position, ...stamps(atMs) }),
    category: (id: string, name: string, position = 0, atMs = 1, extra: Record<string, unknown> = {}) => push('price_category', { id, name, color: null, position, updatedBySeat: 1, ...stamps(atMs), ...extra }),
    tab: (id: string, categoryId: string, name: string, position = 0, atMs = 1) => push('price_tab', { id, categoryId, name, position, columns: [{ key: 'cash_wo', label: 'Cash w/o', kind: 'price' }], updatedBySeat: 1, ...stamps(atMs) }),
    row: (id: string, tabId: string, idx: number, name: string, price: string, atMs = 1) => push('price_row', { id, tabId, idx, kind: 'item', nameRuns: [{ t: name }], cells: { cash_wo: price }, updatedBySeat: 1, ...stamps(atMs) })
  }
}

const hashes = async (db: PhoneDb, kind: PriceKind) => new Map((await listLocalHashes(db, kind, { offsetMs: null, appVer: APP })).map((l) => [l.recId, l.hash]))
async function expectConverged(w: World, ...dbs: PhoneDb[]): Promise<void> {
  for (const db of dbs) for (const kind of ['price_tier', 'price_category', 'price_tab', 'price_row'] as const) {
    const local = await hashes(db, kind)
    for (const rec of w.server.records(w.orgId).filter((r) => r.kind === kind)) expect(local.get(rec.recId), `${kind} ${rec.recId}`).toBe(rec.payloadHash)
  }
}

describe('phone database step 2 (Phase 244)', () => {
  it('adds the four price stores with their indexes and keeps what a version-1 database held', async () => {
    const factory = new IDBFactory()
    await new Promise<void>((res, rej) => { // a phone that shipped with step 1 only
      const r = factory.open(DB_NAME, 1)
      r.onupgradeneeded = () => { for (const n of ['meta', 'settings', 'sync_record_state', 'sync_outbox', 'sync_aside', 'drafts']) r.result.createObjectStore(n, { keyPath: n === 'sync_record_state' || n === 'sync_aside' ? ['kind', 'rec_id'] : n === 'meta' || n === 'settings' ? 'key' : 'id' }); r.result.createObjectStore('bills', { keyPath: 'id' }); r.result.createObjectStore('bill_rows', { keyPath: 'id' }); r.result.createObjectStore('bill_revisions', { keyPath: ['bill_id', 'revision'] }); r.result.createObjectStore('parties', { keyPath: 'id' }); r.transaction!.objectStore('meta').put({ key: 'branch_id', value: 'keep-me' }) }
      r.onsuccess = () => { r.result.close(); res() }
      r.onerror = () => rej(r.error)
    })
    const db = await openPhoneDb({ factory })
    expect(db.idb.version).toBe(2)
    expect(await getMetaValue(db, 'branch_id')).toBe('keep-me')
    expect([...db.idb.objectStoreNames]).toEqual(expect.arrayContaining(Object.keys(STORE_DEFS_V2)))
    expect([...db.idb.transaction('price_rows').objectStore('price_rows').indexNames]).toEqual(['tab_idx'])
    expect([...db.idb.transaction('price_tabs').objectStore('price_tabs').indexNames]).toEqual(['category_id_idx'])
    expect(await hasPriceList(db)).toBe(false)
  })
})

describe('phone Price List repo (Phase 244)', () => {
  it('saves records, queues each change once, lists only live ones and cascades a delete', async () => {
    const w = world()
    const a = await phone(w, 2)
    const cat = uuid(), tab = uuid(), r1 = uuid(), r2 = uuid()
    await a.save('price_category', { id: cat, name: 'Panna', color: null, position: 0 })
    await a.save('price_tab', { id: tab, categoryId: cat, name: 'Small', position: 0, columns: [] })
    await a.save('price_row', { id: r2, tabId: tab, idx: 1, kind: 'item', nameRuns: [{ t: 'Beta' }], cells: { cash_wo: '20' } })
    await a.save('price_row', { id: r1, tabId: tab, idx: 0, kind: 'item', nameRuns: [{ t: 'Alpha' }], cells: { cash_wo: '10' } })
    expect((await listRows(a.db, tab)).map((r) => r.id)).toEqual([r1, r2])
    expect((await listPending(a.db)).map((p) => p.kind).sort()).toEqual(['price_category', 'price_row', 'price_row', 'price_tab'])
    expect(await a.del('price_category', cat)).toBe(4) // category + tab + two rows
    expect(await listCategories(a.db)).toEqual([])
    expect(await listTabs(a.db, cat)).toEqual([])
    expect(await listRows(a.db, tab)).toEqual([])
    expect(await a.del('price_category', cat)).toBe(0) // already gone
    expect((await listPending(a.db)).length).toBe(4) // one row per record, replaced not doubled
    expect(await listTiers(a.db)).toEqual([])
  })
  it('a read-only tab cannot write', async () => {
    const db = await openPhoneDb({ factory: new IDBFactory(), writer: { held: false } })
    await expect(savePriceRecord(db, 'price_category', { id: uuid(), name: 'X', color: null, position: 0 }, { at: iso(0), branchId: 'b', seatNo: 2 })).rejects.toMatchObject({ code: 'read-only' })
  })
})

describe('phone sync of the four kinds (Phase 244)', () => {
  it('PC -> phone: the records arrive as received (same hash as the server), twice changes nothing', async () => {
    const w = world()
    const desk = await pc(w)
    const [tierId, catId, tabId, rowId] = [uuid(), uuid(), uuid(), uuid()]
    await desk.tier(tierId, 'cash_wo', 'Cash w/o', 0)
    await desk.category(catId, 'Panna', 0, 1, { futureField: 'kept' })
    await desk.tab(tabId, catId, 'Small')
    await desk.row(rowId, tabId, 0, 'Assam', '110')
    const p = await phone(w, 2)
    const r1 = await p.pull()
    expect(r1.applied).toBe(4)
    expect((await listTiers(p.db)).map((t) => t.key)).toEqual(['cash_wo'])
    expect((await listRows(p.db, tabId)).map((r) => r.cells.cash_wo)).toEqual(['110'])
    await expectConverged(w, p.db) // includes the unknown field: it was kept, so the hash is the server's
    expect((await p.pull()).applied).toBe(0)
    expect(await listPending(p.db)).toEqual([]) // nothing that came from the notebook is sent back
  })
  it('phone -> PC and phone -> phone: a local edit is pushed once, the other phone gets it, the later edit wins', async () => {
    const w = world()
    const a = await phone(w, 2), b = await phone(w, 3)
    const cat = uuid(), tab = uuid(), row = uuid()
    w.at(1000)
    await a.save('price_category', { id: cat, name: 'Taps', color: null, position: 0 })
    await a.save('price_tab', { id: tab, categoryId: cat, name: 'Brass', position: 0, columns: [] })
    await a.save('price_row', { id: row, tabId: tab, idx: 0, kind: 'item', nameRuns: [{ t: 'Elbow' }], cells: { cash_wo: '5' } })
    const sent = await a.push()
    expect(sent.accepted).toBe(3)
    expect(await listPending(a.db)).toEqual([])
    await b.pull()
    expect((await listRows(b.db, tab)).map((r) => r.cells.cash_wo)).toEqual(['5'])
    w.at(5000)
    await b.save('price_row', { id: row, tabId: tab, idx: 0, kind: 'item', nameRuns: [{ t: 'Elbow' }], cells: { cash_wo: '6' } })
    await b.push()
    await a.pull()
    expect((await listRows(a.db, tab)).map((r) => r.cells.cash_wo)).toEqual(['6'])
    await expectConverged(w, a.db, b.db)
  })
  it('a tombstone from another phone removes the record from the lists; an older version is ignored', async () => {
    const w = world()
    const a = await phone(w, 2), b = await phone(w, 3)
    const cat = uuid()
    w.at(1000)
    await a.save('price_category', { id: cat, name: 'Old', color: null, position: 0 })
    await a.push(); await b.pull()
    expect((await listCategories(b.db)).length).toBe(1)
    w.at(2000)
    await a.del('price_category', cat)
    await a.push(); await b.pull()
    expect(await listCategories(b.db)).toEqual([])
    await expectConverged(w, a.db, b.db)
  })
  it('two live categories with the same name keep the received one under a unique name; two tiers with one key keep the smaller id', async () => {
    const w = world()
    const desk = await pc(w)
    const p = await phone(w, 2)
    const mine = uuid()
    await p.save('price_category', { id: mine, name: 'Panna', color: null, position: 0 })
    await desk.category(uuid(), 'panna', 1)
    await p.pull()
    const names = (await listCategories(p.db)).map((c) => c.name)
    expect(names).toHaveLength(2)
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(2)
    const lo = '00000000-0000-4000-8000-000000000001', hi = 'ffffffff-0000-4000-8000-000000000001'
    await p.save('price_tier', { id: hi, key: 'k1', label: 'One', position: 0 })
    await desk.tier(lo, 'k1', 'One', 0, 2)
    await p.pull()
    expect((await listTiers(p.db)).map((t) => t.id)).toEqual([lo])
  })
})

describe('first sync and backup (Phase 244)', () => {
  it('the first sync compare includes the Price List kinds and downloads them', async () => {
    const w = world()
    const desk = await pc(w)
    const catId = uuid(), tabId = uuid()
    await desk.category(catId, 'Panna'); await desk.tab(tabId, catId, 'Small'); await desk.row(uuid(), tabId, 0, 'Assam', '110')
    const p = await phone(w, 2)
    const prev = await p.engine.prepareFirstSync()
    expect(prev.plans.filter((x) => x.kind.startsWith('price_')).reduce((n, x) => n + x.counts.download, 0)).toBe(3)
    await p.engine.completeFirstSync(prev, { mode: 'all' })
    await p.pull()
    expect((await listTabs(p.db, catId)).length).toBe(1)
    await expectConverged(w, p.db)
  })
  it('a phone-only Price List record is queued as "upload" by the first sync compare', async () => {
    const w = world()
    const p = await phone(w, 2)
    await p.save('price_category', { id: uuid(), name: 'Mine', color: null, position: 0 })
    const prev = await p.engine.prepareFirstSync()
    const up = prev.plans.find((x) => x.kind === 'price_category')!.counts.upload
    expect(up).toBe(1)
  })
  it('a server that does not know the Price List kinds (file 18 not run) does not stop the first sync', async () => {
    const w = world()
    const wrap = (port: InMemorySharedTransport): PhoneSharedPort => new Proxy(port, { get: (t, k, rcv) => {
      if (k !== 'manifest') return Reflect.get(t, k, rcv)
      return async (a: { kind: string }) => { if (a.kind.startsWith('price_')) throw new SharedTransportError('invalid_input'); return (t as unknown as { manifest(x: unknown): Promise<unknown> }).manifest(a) }
    } }) as unknown as PhoneSharedPort
    const p = await phone(w, 2, wrap)
    const prev = await p.engine.prepareFirstSync()
    expect(prev.plans.filter((x) => x.kind.startsWith('price_')).every((x) => x.counts.total === 0)).toBe(true)
  })
  it('backup format 2 carries the Price List; a format-1 file still imports and an older app would call format 2 "newer"', async () => {
    const w = world()
    const p = await phone(w, 2)
    const cat = uuid()
    await p.save('price_category', { id: cat, name: 'Keep', color: null, position: 0 })
    const file = await exportBackup(p.db, { appVersion: APP, now: () => new Date(T0) })
    expect(file.counts.price_categories).toBe(1)
    const json = JSON.parse(await file.blob.text()) as { format_version: number; stores: Record<string, unknown[]> }
    expect(json.format_version).toBe(2)
    const other = await openPhoneDb({ factory: new IDBFactory() })
    await importBackup(other, JSON.stringify(json))
    expect((await listCategories(other)).map((c) => c.name)).toEqual(['Keep'])
    const v1 = { ...json, format_version: 1, stores: { ...json.stores, price_categories: [], price_tiers: [], price_tabs: [], price_rows: [] } }
    delete (v1.stores as Record<string, unknown>).price_tiers
    await putRecord(other, 'price_tiers', { id: 'x', key: 'k', label: 'L', position: 0, createdAt: 'a', updatedAt: 'a', deletedAt: null, branchId: 'b' })
    await importBackup(other, JSON.stringify(v1))
    expect(await listCategories(other)).toEqual([])
  })
})
