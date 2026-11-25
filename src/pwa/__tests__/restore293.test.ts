import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import '../../shared/format'
import { createEmptyBill } from '../../shared/billModel'
import { row } from '../../shared/__fixtures__/bills'
import { generateSeatCode } from '../../shared/master/seatCode'
import { InMemorySharedServer, InMemorySharedTransport, SharedTransportError } from '../../main/sync/sharedTransport'
import { countRecords, deleteRecord, getAllRecords, openPhoneDb, type PhoneDb } from '../data/db'
import { saveBillWithParty } from '../data/partiesRepo'
import { withOutbox } from '../sync/outbox'
import { linkPhoneToOrganisation } from '../sync/branch'
import { createPhoneConnect } from '../sync/connect'
import { createPhoneSyncEngine } from '../sync/engine'
import { createPhoneMasterClient } from '../sync/master'
import { runRestore, restoreCountLine, wantedCounts, RESTORE_LIMIT_LINE, RESTORE_STATE_KEY, RESTORE_TITLE, type RestoreProgress } from '../sync/restore'
import { createPhoneSyncRuntime } from '../sync/runtime'
import { createSessionVault } from '../sync/session'
import { getRaw } from '../sync/syncMeta'
import { publishSeatRights, resolveSeatRights } from '../data/seatRights'
import type { PhoneSharedPort } from '../sync/transport'
import { ConnectCode } from '../ui/ConnectCode'
import { RestoreScreen } from '../ui/RestoreScreen'
import { checkDataClearedTwo, dbMarker, noteHadRecords } from '../ui/protectionRead'
import type { SaveBillInput } from '../data/billsRepo'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange

/** Phase 293: restore after a wipe. Fake master fetch + in-memory company server; every string is invented (no real data, no real Supabase). */
const LICENSE = 'Q3-ABCD-EFGH-JKLM'
const URL_ = 'https://example-project.supabase.co'
const ANON = 'invented-anon-key-for-tests'
const SEAT1 = { email: 'seat1@example.test', password: 'pw-1-secret' }
const SEAT2 = { email: 'seat2@example.test', password: 'invented-seat-password-1' }
const CODE = generateSeatCode(Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 3))
const T0 = Date.parse('2026-11-25T05:00:00.000Z')
const APP = '0.1.63'
const uuid = (): string => globalThis.crypto.randomUUID()

function world() {
  const server = new InMemorySharedServer({ now: () => T0 })
  server.addOrg({ licenseKey: LICENSE, seats: [SEAT1, SEAT2] })
  const calls: string[] = []
  let redeemReply: { status: number; body: unknown } = { status: 200, body: { ok: true, bundle: { v: 1, company: { id: 'c1', label: 'Acme' }, supabaseUrl: URL_, anonKey: ANON, license: LICENSE, seat: { no: 2, email: SEAT2.email, password: SEAT2.password }, profile: null, deviceToken: 'D'.repeat(43) } } }
  const master = createPhoneMasterClient({
    url: 'https://master-example.supabase.co', anon: 'invented-master-anon-key-for-tests', appVersion: APP, sleep: async () => undefined,
    fetchImpl: async (url) => {
      const name = url.split('/').pop()!
      calls.push(name)
      if (name !== 'redeem') throw new Error('network') // heartbeat / payments: unreachable in these tests (the extras report "later")
      return { status: redeemReply.status, text: async () => JSON.stringify(redeemReply.body) }
    }
  })
  return { server, calls, master, setRedeem: (r: { status: number; body: unknown }) => { redeemReply = r } }
}
type World = ReturnType<typeof world>

let seq = 0
function billInput(name: string): SaveBillInput {
  const b = createEmptyBill({ branchId: 'x', formatId: 'non_gst', billDate: '2026-11-20' })
  return { bill: { id: uuid(), party: { name, phone: '', address: '', transport: '' }, formatId: b.formatId, extraCols: [], paperOverride: null, billDate: b.billDate, rows: [row(`item ${++seq}`, '2', '50')] }, partyId: null }
}

/** An "old phone": seat 1 saves `n` bills (own customer each), first-syncs and pushes them to the server. */
async function seedServer(w: World, n: number): Promise<void> {
  // The live rights snapshot is module-wide: the old phone is seat 1 (every right), whatever an earlier test's blank phone published.
  publishSeatRights(resolveSeatRights({ linked: false, cached: null, status: { serverKnows: 'unknown', at: '', error: '' } }))
  const db = await openPhoneDb({ factory: new IDBFactory() })
  const port = new InMemorySharedTransport(w.server)
  const vault = createSessionVault(db)
  const r = await linkPhoneToOrganisation(db, port, vault, { supabaseUrl: URL_, anonKey: ANON, licenseKey: LICENSE, email: SEAT1.email, password: SEAT1.password, branchName: 'Old phone', poPrefix: 'OP' }, () => T0)
  expect(r.ok).toBe(true)
  const connect = createPhoneConnect(db, vault, port)
  const engine = createPhoneSyncEngine({ db, appVer: APP, now: () => new Date(T0), setTimer: () => 0, clearTimer: () => undefined, env: { onVisible: () => () => undefined, onOnline: () => () => undefined }, connect: connect.connect })
  await engine.completeFirstSync(await engine.prepareFirstSync(), { mode: 'all' })
  for (let i = 0; i < n; i++) await saveBillWithParty(db, billInput(`Customer ${i}`), { ...withOutbox({ now: () => new Date(T0) }), now: () => new Date(T0) })
  for (let i = 0; i < Math.ceil(n / 50) + 1; i++) await engine.syncNow()
  engine.stop()
}

/** A blank phone that has just redeemed the code (as the one-code screen does), on a port the test can wrap. */
async function blankPhone(w: World, wrap?: (p: InMemorySharedTransport) => PhoneSharedPort) {
  const db = await openPhoneDb({ factory: new IDBFactory() })
  const runtime = createPhoneSyncRuntime({ db, appVer: APP, makeTransport: () => (wrap ? wrap(new InMemorySharedTransport(w.server)) as InMemorySharedTransport : new InMemorySharedTransport(w.server)), master: w.master, vault: createSessionVault(db), engine: { setTimer: () => 0, clearTimer: () => undefined, env: { onVisible: () => () => undefined, onOnline: () => () => undefined } } })
  return { db, runtime }
}
const counts = async (db: PhoneDb) => ({ bills: await countRecords(db, 'bills'), parties: await countRecords(db, 'parties') })

describe('Phase 293 restore: blank phone + one code', () => {
  it('redeems the code, restores everything with scope all, reports progress by kind, ends done; the extras that cannot be fetched are named', async () => {
    const w = world(); await seedServer(w, 12)
    const { db, runtime } = await blankPhone(w)
    expect(await counts(db)).toEqual({ bills: 0, parties: 0 })
    expect((await runtime.redeem(CODE)).ok).toBe(true)
    const seen: RestoreProgress[] = []
    const r = await runtime.restore((p) => seen.push(p))
    expect(r.ok).toBe(true)
    expect(await counts(db)).toEqual({ bills: 12, parties: 12 })
    expect(seen[0]?.stage).toBe('compare')
    expect(seen.at(-1)?.stage).toBe('done')
    expect(seen.at(-1)?.have).toEqual({ bills: 12, customers: 12, priceList: 0 })
    expect(seen.every((p) => p.have.bills <= p.want.bills && p.have.customers <= p.want.customers)).toBe(true)
    if (r.ok) expect(r.later).toContain('company') // the fake master cannot be reached for the profile: the phone retries by itself
    expect(await getRaw(db, RESTORE_STATE_KEY, 'x')).toBeNull()
    expect(runtime.engine.state()).toBe('running')
    expect(restoreCountLine(seen.at(-1) as RestoreProgress)).toBe('12 of 12 bills · 12 of 12 customers')
  })

  it('a wrong code restores nothing: the redeem fails in plain words and the database stays blank', async () => {
    const w = world(); await seedServer(w, 3)
    w.setRedeem({ status: 400, body: { ok: false, code: 'Q3M01', error: 'invalid_code', message: 'x' } })
    const { db, runtime } = await blankPhone(w)
    const r = await runtime.redeem(CODE)
    expect(r.ok).toBe(false)
    expect(await counts(db)).toEqual({ bills: 0, parties: 0 })
    expect(runtime.engine.state()).not.toBe('running')
  })

  it('offline before the compare: plain failure, nothing written, "Try again" starts over and works', async () => {
    const w = world(); await seedServer(w, 4)
    let offline = true
    const { db, runtime } = await blankPhone(w, (p) => new Proxy(p, { get: (t, k) => (k === 'manifest' && offline ? async () => { throw new SharedTransportError('offline') } : (t as never as Record<string | symbol, unknown>)[k]) }))
    expect((await runtime.redeem(CODE)).ok).toBe(true)
    const bad = await runtime.restore()
    expect(bad).toMatchObject({ ok: false, kind: 'offline', resumes: false })
    expect(await counts(db)).toEqual({ bills: 0, parties: 0 })
    expect(await getRaw(db, RESTORE_STATE_KEY, null)).toBeNull()
    offline = false
    const good = await runtime.restore()
    expect(good.ok).toBe(true)
    expect(await counts(db)).toEqual({ bills: 4, parties: 4 })
  })

  it('a failure DURING the download resumes: the second run does not compare again and finishes the rest', async () => {
    const w = world(); await seedServer(w, 6)
    let manifests = 0; let failPull = true
    const { db, runtime } = await blankPhone(w, (p) => new Proxy(p, { get: (t, k) => {
      if (k === 'manifest') return (a: never) => { manifests++; return t.manifest(a) }
      if (k === 'pull' && failPull) return async () => { throw new SharedTransportError('offline') }
      return (t as never as Record<string | symbol, unknown>)[k]
    } }))
    await runtime.redeem(CODE)
    const bad = await runtime.restore()
    expect(bad).toMatchObject({ ok: false, resumes: true })
    expect(await getRaw(db, RESTORE_STATE_KEY, null)).toBe('applied')
    const afterFirst = manifests
    failPull = false
    const good = await runtime.restore()
    expect(good.ok).toBe(true)
    expect(manifests).toBe(afterFirst) // resumed: no new compare
    expect(await counts(db)).toEqual({ bills: 6, parties: 6 })
  })

  it('large data: more records than one manifest page all arrive', async () => {
    const w = world(); await seedServer(w, 260)
    const { db, runtime } = await blankPhone(w)
    await runtime.redeem(CODE)
    const r = await runtime.restore()
    expect(r.ok).toBe(true)
    expect(await counts(db)).toEqual({ bills: 260, parties: 260 })
  }, 60_000)
})

describe('Phase 293 restore: signed-in phone that lost its data (the marker case)', () => {
  it('marker says data existed + database empty + login present = cleared; "Restore from the server" refills it without a code', async () => {
    const w = world(); await seedServer(w, 5)
    const { db, runtime } = await blankPhone(w)
    await runtime.redeem(CODE)
    expect((await runtime.restore()).ok).toBe(true)
    await noteHadRecords(db)
    // A partial wipe: the records go, the sync login and the markers stay.
    for (const store of ['bills', 'bill_rows', 'bill_revisions', 'parties'] as const) for (const rec of await getAllRecords<Record<string, unknown>>(db, store)) {
      const key = store === 'bill_revisions' ? [rec.bill_id as string, rec.revision as number] : (rec.id as string)
      await deleteRecord(db, store, key)
    }
    expect(await counts(db)).toEqual({ bills: 0, parties: 0 })
    const verdict = await checkDataClearedTwo({ bills: 0, customers: 0, linked: true }, null, dbMarker(db))
    expect(verdict.verdict).toBe('cleared')
    const r = await runtime.restore()
    expect(r.ok).toBe(true)
    expect(await counts(db)).toEqual({ bills: 5, parties: 5 })
  })

  it('an untouched phone with no marker is never offered a restore', async () => {
    const w = world(); const { db } = await blankPhone(w)
    expect((await checkDataClearedTwo({ bills: 0, customers: 0, linked: false }, null, dbMarker(db))).verdict).toBe('ok')
  })
})

describe('Phase 293 restore: pure parts and screens', () => {
  it('wantedCounts sums bills, customers and the four Price List kinds', () => {
    const c = (download: number, skip = 0) => ({ skip, upload: 0, download, conflict: 0, total: download + skip })
    expect(wantedCounts({ plans: [{ kind: 'bill', counts: c(5, 1) }, { kind: 'party', counts: c(4) }, { kind: 'price_tab', counts: c(2) }, { kind: 'price_row', counts: c(7) }] } as never)).toEqual({ bills: 6, customers: 4, priceList: 9 })
  })
  it('a read-only tab refuses in plain words and writes nothing', async () => {
    const db = { canWrite: () => false } as unknown as PhoneDb
    const r = await runRestore({ db, engine: { prepareFirstSync: async () => { throw new Error('no') }, completeFirstSync: async () => { throw new Error('no') }, syncNow: async () => { throw new Error('no') } } })
    expect(r).toMatchObject({ ok: false, kind: 'read_only' })
  })
  it('the blank phone screen says "Restoring a phone? Type the code" with the one-line limit; a phone that is not blank keeps the old wording', async () => {
    const db = await openPhoneDb({ factory: new IDBFactory() })
    const base = { db, mode: 'first' as const, connect: { ready: () => true, redeem: async () => ({ ok: false as const, code: 'Q3M99' as const, message: 'x' }) }, onLinked: () => undefined, onNotNow: () => undefined }
    const restore = { run: async () => ({ ok: true as const, have: { bills: 0, customers: 0, priceList: 0 }, later: [] }) }
    const blank = renderToStaticMarkup(createElement(ConnectCode, { ...base, restore, blank: true }))
    expect(blank).toContain(RESTORE_TITLE)
    expect(blank).toContain(RESTORE_LIMIT_LINE)
    const used = renderToStaticMarkup(createElement(ConnectCode, { ...base, restore, blank: false }))
    expect(used).toContain('Connect to your company')
    expect(used).not.toContain(RESTORE_TITLE)
    expect(renderToStaticMarkup(createElement(ConnectCode, base))).toContain('Connect to your company')
  })
  it('the "Restore from the server" screen needs no code and shows the one-line limit', () => {
    const html = renderToStaticMarkup(createElement(RestoreScreen, { api: { run: async () => ({ ok: false as const, kind: 'offline', message: 'x', resumes: false }) }, mode: 'server', onDone: () => undefined, onNotNow: () => undefined }))
    expect(html).toContain('Restore from the server')
    expect(html).toContain(RESTORE_LIMIT_LINE)
    expect(html).not.toContain('Company code')
  })
})
