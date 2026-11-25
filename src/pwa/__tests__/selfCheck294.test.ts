import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
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
import { withSelfCheck } from '../ui/dashboardModel'
import { SELF_CHECK_DONE_KEY, selfCheckDue, selfCheckLine, readSelfCheck } from '../sync/selfCheck'
import { createPhoneSyncRuntime } from '../sync/runtime'
import { createSessionVault } from '../sync/session'
import { getRaw, readCursor } from '../sync/syncMeta'
import { outboxCounts } from '../sync/outbox'
import { publishSeatRights, resolveSeatRights } from '../data/seatRights'
import type { PhoneSharedPort } from '../sync/transport'
import type { SaveBillInput } from '../data/billsRepo'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange

/** Phase 294: the daily self-check. Fake master fetch + in-memory company server; every string is invented (no real data, no real Supabase). */
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


/** A restored phone (the Phase 293 path) on a port the test can watch, with its runtime. */
async function restoredPhone(w: World, n: number, spy?: { manifests: number; pulls: number; offline: boolean }) {
  await seedServer(w, n)
  const { db, runtime } = await blankPhone(w, (p) => new Proxy(p, { get: (t, k) => {
    if (k === 'manifest') return (a: never) => { if (spy) { spy.manifests++; if (spy.offline) return Promise.reject(new SharedTransportError('offline')) } return t.manifest(a) }
    if (k === 'pull') return (a: never) => { if (spy) spy.pulls++; return t.pull(a) }
    return (t as never as Record<string | symbol, unknown>)[k]
  } }))
  expect((await runtime.redeem(CODE)).ok).toBe(true)
  expect((await runtime.restore()).ok).toBe(true)
  return { db, runtime }
}
const wipe = async (db: PhoneDb, ids?: string[]): Promise<void> => {
  for (const store of ['bills', 'bill_rows', 'bill_revisions', 'parties'] as const) for (const rec of await getAllRecords<Record<string, unknown>>(db, store)) {
    if (ids && !(ids.includes(rec.id as string) || ids.includes(rec.bill_id as string))) continue
    await deleteRecord(db, store, store === 'bill_revisions' ? [rec.bill_id as string, rec.revision as number] : (rec.id as string))
  }
}

describe('Phase 294 self-check: pure parts', () => {
  const now = Date.parse('2026-11-25T10:00:00.000Z')
  const H = 3600_000
  it('selfCheckDue: on start (never checked), then at most every 24 h; never offline or while busy', () => {
    expect(selfCheckDue(now, null, true, true)).toBe(true)
    expect(selfCheckDue(now, new Date(now - 23 * H).toISOString(), true, true)).toBe(false)
    expect(selfCheckDue(now, new Date(now - 24 * H).toISOString(), true, true)).toBe(true)
    expect(selfCheckDue(now, new Date(now - 49 * H).toISOString(), true, true)).toBe(true)
    expect(selfCheckDue(now, null, false, true)).toBe(false)
    expect(selfCheckDue(now, null, true, false)).toBe(false)
    expect(selfCheckDue(new Date(now), new Date(now + 5 * H).toISOString(), true, true)).toBe(true) // clock went backwards
    expect(selfCheckDue(now, 'garbage', true, true)).toBe(true)
  })
  it('the status words are the three plain lines', () => {
    const at = new Date(2026, 10, 25, 14, 5).toISOString() // local 14:05
    expect(selfCheckLine({ at, outcome: 'in_step', fetched: 0, reason: '' })).toBe('Checked 14:05, all in step')
    expect(selfCheckLine({ at, outcome: 'fetched', fetched: 37, reason: '' })).toBe('Fetched 37 missing records')
    expect(selfCheckLine({ at, outcome: 'fetched', fetched: 1, reason: '' })).toBe('Fetched 1 missing record')
    expect(selfCheckLine({ at, outcome: 'offline', fetched: 0, reason: '' })).toBe('Could not check: offline')
    expect(selfCheckLine({ at, outcome: 'failed', fetched: 0, reason: 'sign in again' })).toBe('Could not check: sign in again')
    expect(selfCheckLine(null)).toBe('')
  })
})

describe('Phase 294 self-check: against an in-memory server', () => {
  it('a healthy phone does nothing: counts agree, nothing is pulled, nothing is written but the status line', async () => {
    const w = world(); const spy = { manifests: 0, pulls: 0, offline: false }
    const { db, runtime } = await restoredPhone(w, 6, spy)
    const before = { counts: await counts(db), cursor: await readCursor(db), outbox: await outboxCounts(db) }
    spy.pulls = 0
    const r = await runtime.selfCheck.run()
    expect(r.outcome).toBe('in_step')
    expect(spy.pulls).toBe(0)
    expect(await counts(db)).toEqual(before.counts)
    expect(await readCursor(db)).toBe(before.cursor)
    expect(await outboxCounts(db)).toEqual(before.outbox)
    expect(selfCheckLine(await readSelfCheck(db))).toMatch(/^Checked \d\d:\d\d, all in step$/)
    expect(await getRaw(db, SELF_CHECK_DONE_KEY, null)).toBe(r.at)
  })

  it('a deleted local store is refilled through the normal pull, and the status says how many', async () => {
    const w = world(); const { db, runtime } = await restoredPhone(w, 8)
    await wipe(db)
    expect(await counts(db)).toEqual({ bills: 0, parties: 0 })
    const r = await runtime.selfCheck.run()
    expect(r.outcome).toBe('fetched')
    expect(await counts(db)).toEqual({ bills: 8, parties: 8 })
    expect(r.fetched).toBe(16)
    expect(selfCheckLine(await readSelfCheck(db))).toBe('Fetched 16 missing records')
    expect((await runtime.selfCheck.run()).outcome).toBe('in_step') // and the next check is quiet
  })

  it('a newer local edit is kept: only the missing records come back, the edit stays and is not overwritten', async () => {
    const w = world(); const { db, runtime } = await restoredPhone(w, 5)
    publishSeatRights(resolveSeatRights({ linked: false, cached: null, status: { serverKnows: 'unknown', at: '', error: '' } })) // this test edits an old bill: a seat with every right
    const bills = await getAllRecords<{ id: string }>(db, 'bills')
    const edited = bills[0] as { id: string }
    const input = billInput('Edited here')
    input.bill = { ...input.bill, id: edited.id }
    await saveBillWithParty(db, input, { ...withOutbox({ now: () => new Date(T0) }), now: () => new Date(T0 + 1000) })
    const nameOf = async (): Promise<string> => { const b = (await getAllRecords<{ id: string; partySnapshotJson: string }>(db, 'bills')).find((x) => x.id === edited.id); return String((JSON.parse(b?.partySnapshotJson ?? '{}') as { name?: unknown }).name ?? '') }
    const mine = await nameOf()
    expect(mine).toBe('Edited here')
    await wipe(db, bills.slice(1, 3).map((b) => b.id)) // two OTHER bills go missing
    const r = await runtime.selfCheck.run()
    expect(r.outcome).toBe('fetched')
    expect(await nameOf()).toBe('Edited here')
    expect((await counts(db)).bills).toBe(5)
  })

  it('offline is quiet: a plain line, no throw, the day is not used up, and the next try works', async () => {
    const w = world(); const spy = { manifests: 0, pulls: 0, offline: false }
    const { db, runtime } = await restoredPhone(w, 3, spy)
    spy.offline = true
    const r = await runtime.selfCheck.run()
    expect(r.outcome).toBe('offline')
    expect(selfCheckLine(r)).toBe('Could not check: offline')
    expect(await getRaw(db, SELF_CHECK_DONE_KEY, null)).toBeNull()
    expect(selfCheckDue(new Date(T0), await getRaw(db, SELF_CHECK_DONE_KEY, null), true, true)).toBe(true)
    spy.offline = false
    expect((await runtime.selfCheck.run()).outcome).toBe('in_step')
  })

  it('the check never runs twice at once, and maybeRun honours the 24 h rule', async () => {
    const w = world(); const spy = { manifests: 0, pulls: 0, offline: false }
    const { runtime } = await restoredPhone(w, 3, spy)
    spy.manifests = 0
    const a = runtime.selfCheck.run(); const b = runtime.selfCheck.run()
    expect(runtime.selfCheck.running()).toBe(true)
    expect(a).toBe(b)
    await a
    const oneRun = spy.manifests
    expect(oneRun).toBeGreaterThan(0)
    expect(await runtime.selfCheck.maybeRun({ online: true, idle: true })).toBeNull() // just checked: not due
    expect(spy.manifests).toBe(oneRun)
    expect(runtime.selfCheck.running()).toBe(false)
  })

  it('a phone that is not syncing (read-only tab / first sync not done) is skipped and writes no line', async () => {
    const w = world(); const { db, runtime } = await blankPhone(w)
    const r = await runtime.selfCheck.run()
    expect(r.outcome).toBe('skipped')
    expect(await readSelfCheck(db)).toBeNull()
  })
})

describe('Phase 294 self-check: Dashboard sync line', () => {
  it('the status joins the sync detail when linked; an unlinked phone and a phone never checked are unchanged', () => {
    const ok = { tone: 'ok' as const, text: 'Branch A · synced', detail: '' }
    expect(withSelfCheck(ok, 'Checked 14:05, all in step').detail).toBe('Checked 14:05, all in step')
    expect(withSelfCheck({ ...ok, detail: '2 waiting to send' }, 'Fetched 3 missing records').detail).toBe('2 waiting to send · Fetched 3 missing records')
    expect(withSelfCheck(ok, '')).toBe(ok)
    const off = { tone: 'off' as const, text: 'Sync not set up', detail: 'Sign in under Settings to share bills with your other computers.' }
    expect(withSelfCheck(off, 'Checked 14:05, all in step')).toBe(off)
  })
})
