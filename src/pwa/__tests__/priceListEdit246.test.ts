import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { InMemorySharedServer, InMemorySharedTransport } from '../../main/sync/sharedTransport'
import { ALL_RIGHTS, NO_RIGHTS, type PermFlags } from '../../shared/pricelist/perms'
import type { PriceKind } from '../../shared/sync/priceListRecords'
import { getRecord, openPhoneDb, putRecord, type PhoneDb } from '../data/db'
import { getMetaValue, setMetaValue } from '../data/metaRepo'
import { addCategoryRec, addRow, addTabRec, deletePriceRec, renameCategoryRec, renameTabRec, saveRowEdit, type EditCtx } from '../data/priceListEdit'
import { listCategories, listRows, listTabs, savePriceRecord, type PriceStamp } from '../data/priceListRepo'
import { clearDraft, guardChange, parseCachedPerms, readCachedPerms, readDraft, readRefused, rightsFor, saveDraft, writeCachedPerms, REFUSED_KEY } from '../data/priceRights'
import { linkPhoneToOrganisation } from '../sync/branch'
import { createPhoneConnect } from '../sync/connect'
import { listLocalHashes } from '../sync/encode'
import { listPending, withPriceOutbox } from '../sync/outbox'
import { createPhonePullWorker } from '../sync/pull'
import { createPhonePushWorker } from '../sync/push'
import { createSessionVault } from '../sync/session'
import type { PhoneSharedPort } from '../sync/transport'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange

// Phase 246 (M23): the phone can change the Price List, only as far as the seat's flags allow. Invented names only; no real server, phone or Supabase.
const LICENSE = 'Q3-ABCD-EFGH-JKLM'
const T0 = Date.parse('2026-11-13T10:00:00.000Z')
const APP = '0.1.52'
const uuid = (): string => globalThis.crypto.randomUUID()
const flagsOnly = (...on: (keyof PermFlags)[]): PermFlags => ({ ...NO_RIGHTS, ...Object.fromEntries(on.map((k) => [k, true])) })
const COLS = [
  { key: 'name', label: 'Item', type: 'text', role: 'name', widthPx: 200, align: 'left', hidden: false, frozen: true },
  { key: 'c1', label: 'Rate', type: 'number', role: 'price', tier: 'cash_wo', widthPx: 100, align: 'right', hidden: false, frozen: false },
  { key: 'c2', label: 'Pack', type: 'text', role: 'other', widthPx: 100, align: 'left', hidden: false, frozen: false }
]

/** A local phone database that has a branch (so a change can be stamped) and one category / tab / two rows. */
async function seededDb(opts: { branch?: string | null; writer?: boolean; factory?: IDBFactory } = {}): Promise<PhoneDb> {
  const db = await openPhoneDb({ factory: opts.factory ?? new IDBFactory(), writer: { held: opts.writer !== false } })
  if (opts.branch !== null) await setMetaValue(db, 'branch_id', opts.branch ?? 'branch-phone')
  const stamp: PriceStamp = { at: '2026-11-13T09:00:00.000Z', branchId: 'branch-pc', seatNo: 1 }
  const put = (k: PriceKind, r: Record<string, unknown> & { id: string }) => savePriceRecord(db, k, r, stamp)
  await put('price_tier', { id: 't1', key: 'cash_wo', label: 'cash w/o', position: 0 })
  await put('price_category', { id: 'c1', name: 'Pipes', color: null, position: 0 })
  await put('price_tab', { id: 'tb1', categoryId: 'c1', name: 'PVC pipes', position: 0, columns: COLS })
  await put('price_row', { id: 'r1', tabId: 'tb1', idx: 0, kind: 'item', nameRuns: [{ t: 'PVC pipe 1/2' }], cells: { c1: '110' } })
  await put('price_row', { id: 'r2', tabId: 'tb1', idx: 1, kind: 'item', nameRuns: [{ t: 'PVC pipe 3/4' }], cells: {} })
  await putRecord(db, 'sync_outbox', { id: 'drop-me' }).catch(() => undefined)
  return db
}
const ctx = (db: PhoneDb, flags: PermFlags): EditCtx => ({ db, flags, now: () => new Date(T0), newId: uuid })
const pendingOf = async (db: PhoneDb) => (await listPending(db)).filter((p) => p.kind.startsWith('price_'))
async function clearOutbox(db: PhoneDb): Promise<void> {
  const tx = db.idb.transaction('sync_outbox', 'readwrite'); tx.objectStore('sync_outbox').clear()
  await new Promise<void>((res) => { tx.oncomplete = () => res() })
}

describe('rights: every control against every flag', () => {
  it('fill an empty price = edit; change a price = overwrite; clear = overwrite; each needs ONLY its flag', async () => {
    const db = await seededDb(); await clearOutbox(db)
    // only `edit`: may fill the empty price of r2, may NOT change r1's price
    const e = ctx(db, flagsOnly('edit'))
    expect((await saveRowEdit(e, 'r2', { cells: { c1: '45' } })).ok).toBe(true)
    const no = await saveRowEdit(e, 'r1', { cells: { c1: '120' } })
    expect(no).toMatchObject({ ok: false, reason: 'not_allowed', missing: ['overwrite'] })
    expect(no.ok === false && no.message).toMatch(/not allowed.*Change existing prices.*seat 1/s)
    // only `overwrite`: may change r1, may NOT fill the empty price of another row
    const o = ctx(db, flagsOnly('overwrite'))
    expect((await saveRowEdit(o, 'r1', { cells: { c1: '120' } })).ok).toBe(true)
    expect((await saveRowEdit(o, 'r1', { cells: { c1: '' } })).ok).toBe(true) // clearing is an overwrite
    expect(await saveRowEdit(o, 'r1', { cells: { c1: '77' } })).toMatchObject({ ok: false, missing: ['edit'] })
    // a name change is an edit
    expect(await saveRowEdit(ctx(db, flagsOnly('overwrite')), 'r1', { name: 'Renamed' })).toMatchObject({ ok: false, missing: ['edit'] })
    expect((await saveRowEdit(e, 'r1', { name: 'Renamed' })).ok).toBe(true)
    // no rights at all: everything refused, nothing queued by the refused ones
    const before = (await pendingOf(db)).length
    expect((await saveRowEdit(ctx(db, NO_RIGHTS), 'r2', { name: 'x' })).ok).toBe(false)
    expect((await pendingOf(db)).length).toBe(before)
  })

  it('add item = add; add / rename category and tab = structure; delete = delete (each refused without its flag, allowed with it)', async () => {
    const db = await seededDb(); await clearOutbox(db)
    expect(await addRow(ctx(db, flagsOnly('edit', 'structure', 'delete')), 'tb1', { name: 'New pipe' })).toMatchObject({ ok: false, missing: ['add'] })
    const added = await addRow(ctx(db, flagsOnly('add')), 'tb1', { name: 'New pipe', cells: { c1: '12.50' } })
    expect(added.ok).toBe(true)
    const rows = await listRows(db, 'tb1')
    expect(rows.at(-1)).toMatchObject({ idx: 2, kind: 'item', cells: { c1: '12.5' } }) // canonical decimal string, no float math
    expect(await addCategoryRec(ctx(db, flagsOnly('add', 'edit')), 'Fittings')).toMatchObject({ ok: false, missing: ['structure'] })
    const cat = await addCategoryRec(ctx(db, flagsOnly('structure')), 'Fittings')
    expect(cat.ok).toBe(true)
    expect(await addTabRec(ctx(db, flagsOnly('add')), cat.ok ? cat.id : '', 'Elbows')).toMatchObject({ ok: false, missing: ['structure'] })
    const tab = await addTabRec(ctx(db, flagsOnly('structure')), cat.ok ? cat.id : '', 'Elbows')
    expect(tab.ok).toBe(true)
    expect((await listTabs(db, cat.ok ? cat.id : ''))[0]!.columns.length).toBeGreaterThan(0) // starts with the standard column set
    expect((await renameCategoryRec(ctx(db, flagsOnly('structure')), 'c1', 'Pipes and more')).ok).toBe(true)
    expect(await renameTabRec(ctx(db, flagsOnly('edit')), 'tb1', 'PVC')).toMatchObject({ ok: false, missing: ['structure'] })
    expect(await deletePriceRec(ctx(db, flagsOnly('add', 'edit', 'overwrite', 'structure')), 'price_row', 'r2')).toMatchObject({ ok: false, missing: ['delete'] })
    expect((await deletePriceRec(ctx(db, flagsOnly('delete')), 'price_row', 'r2')).ok).toBe(true)
    expect((await listRows(db, 'tb1')).map((r) => r.id)).not.toContain('r2')
  })

  it('duplicate / empty / invalid input is refused in plain words and queues nothing', async () => {
    const db = await seededDb(); await clearOutbox(db)
    const all = ctx(db, ALL_RIGHTS)
    expect(await addCategoryRec(all, '  pipes ')).toMatchObject({ ok: false, reason: 'duplicate' })
    expect(await addCategoryRec(all, '   ')).toMatchObject({ ok: false, reason: 'empty' })
    expect(await saveRowEdit(all, 'r1', { cells: { c1: 'abc' } })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(await saveRowEdit(all, 'r1', { cells: { c1: '110.00' } })).toMatchObject({ ok: false, reason: 'unchanged' }) // same canonical value
    expect(await saveRowEdit(all, 'nope', { name: 'x' })).toMatchObject({ ok: false, reason: 'missing' })
    expect((await pendingOf(db)).length).toBe(0)
  })

  it('guardChange is the shared rule: a change that alters nothing needs no flag', () => {
    const rec = { id: 'r', tabId: 't', idx: 0, kind: 'item', nameRuns: [{ t: 'A' }], cells: { c1: '1' }, deletedAt: null }
    expect(guardChange(NO_RIGHTS, 'price_row', rec, rec)).toMatchObject({ ok: true, required: [] })
  })
})

describe('queueing, writer tab, branch, drafts', () => {
  it('a save queues exactly ONE outbox row for the record, even with a name and two cells changed', async () => {
    const db = await seededDb(); await clearOutbox(db)
    expect((await saveRowEdit(ctx(db, ALL_RIGHTS), 'r1', { name: 'PVC pipe 1/2 heavy', cells: { c1: '130', c2: '6 m' } })).ok).toBe(true)
    const p = await pendingOf(db)
    expect(p.length).toBe(1)
    expect(p[0]).toMatchObject({ kind: 'price_row', op: 'upsert' })
    expect((await saveRowEdit(ctx(db, ALL_RIGHTS), 'r1', { cells: { c1: '140' } })).ok).toBe(true)
    expect((await pendingOf(db)).length).toBe(1) // replaced, not doubled
  })

  it('deleting a tab tombstones it and its rows, one outbox row each; a refused delete changes nothing', async () => {
    const db = await seededDb(); await clearOutbox(db)
    expect(await deletePriceRec(ctx(db, flagsOnly('edit')), 'price_tab', 'tb1')).toMatchObject({ ok: false, missing: ['delete'] })
    expect((await pendingOf(db)).length).toBe(0)
    expect((await deletePriceRec(ctx(db, flagsOnly('delete')), 'price_tab', 'tb1')).ok).toBe(true)
    expect((await pendingOf(db)).filter((x) => x.op === 'delete').length).toBe(3) // tab + 2 rows
    expect(await listRows(db, 'tb1')).toEqual([])
    expect(await listCategories(db)).toHaveLength(1) // the category itself stays
  })

  it('a tab that is not the writer, and a phone with no branch yet, refuse in plain words and write nothing', async () => {
    const f = new IDBFactory()
    await seededDb({ factory: f })
    const ro = await openPhoneDb({ factory: f, writer: { held: false } })
    expect(await saveRowEdit(ctx(ro, ALL_RIGHTS), 'r1', { name: 'x' })).toMatchObject({ ok: false, reason: 'read_only' })
    const nb = await seededDb({ branch: null })
    const r = await saveRowEdit(ctx(nb, ALL_RIGHTS), 'r1', { name: 'x' })
    expect(r).toMatchObject({ ok: false, reason: 'not_linked' })
    expect((await pendingOf(nb)).length).toBe(0)
  })

  it('the unsaved edit survives a closed tab (same database, new handle); a read-only tab keeps nothing', async () => {
    const factory = new IDBFactory()
    const a = await seededDb({ factory })
    await saveDraft(a, { rowId: 'r1', name: 'half typed', cells: { c1: '1' }, at: '2026-11-13T10:00:00.000Z' })
    a.idb.close()
    const b = await openPhoneDb({ factory, writer: { held: true } })
    expect(await readDraft(b)).toMatchObject({ rowId: 'r1', name: 'half typed', cells: { c1: '1' } })
    await clearDraft(b)
    expect(await readDraft(b)).toBeNull()
    const ro = await openPhoneDb({ factory, writer: { held: false } })
    await saveDraft(ro, { rowId: 'r9', name: 'x', cells: {}, at: '' })
    expect(await readDraft(b)).toBeNull()
  })
})

describe('cached rights', () => {
  it('no sync = full; seat 1 = full; another seat = last server answer; linked with none cached = none [A]; junk is ignored', async () => {
    expect(rightsFor(false, null)).toEqual(ALL_RIGHTS)
    expect(rightsFor(true, null)).toEqual(NO_RIGHTS)
    expect(rightsFor(true, { seatNo: 1, flags: NO_RIGHTS, at: '' })).toEqual(ALL_RIGHTS)
    expect(rightsFor(true, { seatNo: 2, flags: flagsOnly('add'), at: '' })).toEqual(flagsOnly('add'))
    expect(parseCachedPerms({ seatNo: 'x', flags: ALL_RIGHTS })).toBeNull()
    expect(parseCachedPerms({ seatNo: 2, flags: { add: 'yes', edit: true } })?.flags).toEqual(flagsOnly('edit'))
    const db = await seededDb()
    expect(await readCachedPerms(db)).toBeNull()
    await writeCachedPerms(db, { seatNo: 2, flags: { add: true, edit: false } }, '2026-11-13T10:00:00.000Z')
    expect(await readCachedPerms(db)).toEqual({ seatNo: 2, flags: flagsOnly('add'), at: '2026-11-13T10:00:00.000Z' })
  })
})

// ---- with the in-memory shared server (the Phase 244 harness idea) -----------------------------------------------------------------

function world() {
  let clock = T0
  const server = new InMemorySharedServer({ now: () => clock })
  const seats = [1, 2, 3].map((i) => ({ email: `seat${i}@example.test`, password: `pw-${i}-secret` }))
  const { orgId } = server.addOrg({ licenseKey: LICENSE, seats })
  return { server, orgId, seats, now: () => clock, tick: (ms: number) => { clock += ms } }
}
async function linked(w: ReturnType<typeof world>, seat: number) {
  const db = await openPhoneDb({ factory: new IDBFactory() })
  const port = new InMemorySharedTransport(w.server)
  const vault = createSessionVault(db)
  const s = w.seats[seat - 1]!
  const r = await linkPhoneToOrganisation(db, port, vault, { supabaseUrl: 'https://example-project.supabase.co', anonKey: 'invented-anon', licenseKey: LICENSE, email: s.email, password: s.password, branchName: `Phone ${seat}`, poPrefix: `P${seat}` }, w.now)
  expect(r.ok).toBe(true)
  const connect = createPhoneConnect(db, vault, port)
  const conn = async () => { const c = await connect.connect(); return { port: port as PhoneSharedPort, creds: c.creds } }
  const timers = { setTimer: () => 0, clearTimer: () => undefined, now: () => new Date(w.now()) }
  return {
    db, port,
    push: () => createPhonePushWorker({ db, connect: conn, appVer: APP }, timers).runOnce(),
    pull: () => createPhonePullWorker({ db, connect: conn, appVer: APP, newId: uuid }, timers).runOnce(),
    refresh: async () => { const c = await connect.connect(); const a = await port.pricePermsGet({ license: c.creds.license }); await writeCachedPerms(db, a, new Date(w.now()).toISOString()) },
    ctx: (flags: PermFlags): EditCtx => ({ db, flags, now: () => new Date(w.now()), newId: uuid })
  }
}
const hashes = async (db: PhoneDb, kind: PriceKind) => new Map((await listLocalHashes(db, kind, { offsetMs: null, appVer: APP })).map((l) => [l.recId, l.hash]))

describe('with the shared server', () => {
  it('a seat with no granted rights: the phone learns "none", and a change forced past the local guard is refused by the server, settled, and listed WITHOUT content', async () => {
    const w = world()
    const p = await linked(w, 2)
    await p.refresh()
    const learned = (await readCachedPerms(p.db))!
    expect(learned.seatNo).toBe(2)
    expect(rightsFor(true, learned)).toEqual(NO_RIGHTS)
    expect(await saveRowEdit(p.ctx(rightsFor(true, learned)), 'x', { name: 'y' })).toMatchObject({ ok: false, reason: 'missing' }) // nothing there; and no rights anyway
    // Force a record into the outbox as if the rights had been taken away AFTER the change was made:
    const cat = uuid()
    const secret = 'Secret supplier price note'
    await savePriceRecord(p.db, 'price_category', { id: cat, name: secret, color: null, position: 0 }, { at: new Date(w.now()).toISOString(), branchId: (await getMetaValue(p.db, 'branch_id'))!, seatNo: 2 }, withPriceOutbox({ now: () => new Date(w.now()) }))
    expect((await pendingOf(p.db)).length).toBe(1)
    await p.push()
    expect((await pendingOf(p.db)).length).toBe(0) // settled: it stops retrying
    const list = await readRefused(p.db)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ kind: 'price_category', recId: cat, code: 'Q3P01', missing: ['structure'] })
    const stored = JSON.stringify((await getRecord(p.db, 'meta', REFUSED_KEY)) ?? list)
    expect(stored).not.toContain(secret) // ids and missing rights only
    expect((await listCategories(p.db)).map((c) => c.id)).toContain(cat) // stays on this phone only
    expect(w.server.records(w.orgId).filter((r) => r.kind === 'price_category')).toHaveLength(0)
  })

  it('two phones (seat 1 and a granted seat 2) converge with the server after edits, adds and a delete', async () => {
    const w = world()
    const a = await linked(w, 1)
    const b = await linked(w, 2)
    w.server.setPricePerms(w.orgId, 2, ALL_RIGHTS)
    await a.refresh(); await b.refresh()
    expect(rightsFor(true, await readCachedPerms(b.db))).toEqual(ALL_RIGHTS)
    // seat 1 builds a small list on its phone
    const A = a.ctx(ALL_RIGHTS)
    await savePriceRecord(a.db, 'price_tier', { id: uuid(), key: 'cash_wo', label: 'cash w/o', position: 0 }, { at: new Date(w.now()).toISOString(), branchId: (await getMetaValue(a.db, 'branch_id'))!, seatNo: 1 }, withPriceOutbox({ now: () => new Date(w.now()) }))
    const cat = await addCategoryRec(A, 'Pipes'); const catId = cat.ok ? cat.id : ''
    const tab = await addTabRec(A, catId, 'PVC'); const tabId = tab.ok ? tab.id : ''
    const row = await addRow(A, tabId, { name: 'PVC pipe 1/2' }); const rowId = row.ok ? row.id : ''
    await a.push(); w.tick(1000)
    await b.pull()
    expect((await listRows(b.db, tabId)).map((r) => r.id)).toEqual([rowId])
    // seat 2 fills a price and adds an item; seat 1 then deletes the first one
    const B = b.ctx(rightsFor(true, await readCachedPerms(b.db)))
    const cols = (await listTabs(b.db, catId))[0]!.columns as { key: string; role: string }[]
    const priceKey = cols.find((c) => c.role === 'price')!.key
    w.tick(1000)
    expect((await saveRowEdit(B, rowId, { cells: { [priceKey]: '110' } })).ok).toBe(true)
    expect((await addRow(B, tabId, { name: 'PVC pipe 3/4', cells: { [priceKey]: '150' } })).ok).toBe(true)
    await b.push(); w.tick(1000)
    await a.pull(); w.tick(1000)
    expect((await listRows(a.db, tabId)).map((r) => r.cells[priceKey])).toEqual(['110', '150'])
    expect((await deletePriceRec(A, 'price_row', rowId)).ok).toBe(true)
    await a.push(); w.tick(1000)
    await b.pull()
    expect((await listRows(b.db, tabId)).map((r) => r.id)).toHaveLength(1)
    for (const db of [a.db, b.db]) for (const kind of ['price_category', 'price_tab', 'price_row'] as const) {
      const local = await hashes(db, kind)
      for (const rec of w.server.records(w.orgId).filter((r) => r.kind === kind)) expect(local.get(rec.recId), `${kind} ${rec.recId}`).toBe(rec.payloadHash)
    }
    expect(await readRefused(a.db)).toEqual([])
    expect(await readRefused(b.db)).toEqual([])
  })
})
