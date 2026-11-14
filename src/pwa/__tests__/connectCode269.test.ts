import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { checkChar, generateSeatCode, SEAT_ALPHABET } from '../../shared/master/seatCode'
import { InMemorySharedServer, InMemorySharedTransport } from '../../main/sync/sharedTransport'
import { openPhoneDb } from '../data/db'
import { getBranchLink } from '../sync/branch'
import { createPhoneConnect } from '../sync/connect'
import { createPhoneMasterClient } from '../sync/master'
import { createPhoneRecredential, isSeatRemoved, SEAT_REMOVED_WORDS } from '../sync/recredential'
import { createPhoneSyncRuntime } from '../sync/runtime'
import { createSessionVault } from '../sync/session'
import { ConnectCode } from '../ui/ConnectCode'
import { codeFeedback, connectGate } from '../ui/connectCodeModel'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange

/** Phase 269: one-field first launch + silent re-credential. Fake fetch, in-memory company server, invented strings; no real master / Supabase. */
const LICENSE = 'Q3-ABCD-EFGH-JKLM'
const URL_ = 'https://example-project.supabase.co'
const ANON = 'invented-anon-key-for-tests'
const MASTER_URL = 'https://master-example.supabase.co'
const MASTER_ANON = 'invented-master-anon-key-for-tests'
const SEAT_EMAIL = 'seat2@example.test'
const SEAT_PW = 'invented-seat-password-1'
const NEW_PW = 'invented-seat-password-2'
const DEVICE_TOKEN = 'D'.repeat(43)
const CODE = generateSeatCode(Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 3))
const NOW0 = Date.parse('2026-11-14T05:00:00.000Z')

type Reply = { status: number; body: unknown } | 'throw'
const ok = (body: unknown): Reply => ({ status: 200, body })
const fail = (status: number, code: string, error: string): Reply => ({ status, body: { ok: false, code, error, message: 'x' } })

function world() {
  const clock = { t: NOW0 }
  const server = new InMemorySharedServer({ now: () => clock.t })
  server.addOrg({ licenseKey: LICENSE, seats: [{ email: 'seat1@example.test', password: 'pw-1' }, { email: SEAT_EMAIL, password: SEAT_PW }] })
  const calls: string[] = []
  const replies: Record<string, Reply[]> = {}
  const bundle = { v: 1, company: { id: 'c1', label: 'Acme' }, supabaseUrl: URL_, anonKey: ANON, license: LICENSE, seat: { no: 2, email: SEAT_EMAIL, password: SEAT_PW }, profile: null, deviceToken: DEVICE_TOKEN }
  const refreshOk = (password: string | null): Reply => ok({ ok: true, supabaseUrl: URL_, anonKey: ANON, license: LICENSE, seat: { no: 2, email: SEAT_EMAIL, password }, legacy: password === null })
  const master = createPhoneMasterClient({
    url: MASTER_URL, anon: MASTER_ANON, appVersion: '0.1.56', sleep: async () => undefined,
    fetchImpl: async (url) => {
      const name = url.split('/').pop()!
      calls.push(name)
      const r = replies[name]?.shift()
      if (!r || r === 'throw') throw new Error('network')
      return { status: r.status, text: async () => JSON.stringify(r.body) }
    }
  })
  return { server, clock, calls, replies, bundle, master, refreshOk }
}
async function newDb() { return openPhoneDb({ factory: new IDBFactory() }) }

/** A runtime on the in-memory company server, with the master on the fake fetch. */
async function linkedPhone(w: ReturnType<typeof world>) {
  const db = await newDb()
  const runtime = createPhoneSyncRuntime({ db, appVer: '0.1.56', makeTransport: () => new InMemorySharedTransport(w.server), master: w.master, vault: createSessionVault(db) })
  w.replies.redeem = [ok({ ok: true, bundle: w.bundle })]
  const r = await runtime.redeem(CODE)
  return { db, runtime, vault: runtime.vault, r }
}

describe('Phase 269 code feedback (offline, as you type)', () => {
  it('empty / typing / ok / typo / odd character / too long; paste-friendly', () => {
    expect(codeFeedback('').state).toBe('empty')
    expect(codeFeedback('Q3C-AB')).toMatchObject({ state: 'typing', text: '2 of 16 characters', canConnect: false })
    expect(codeFeedback(CODE)).toMatchObject({ state: 'ok', canConnect: true })
    expect(codeFeedback(`  ${CODE.toLowerCase().replace(/-/g, ' ')}  `).canConnect).toBe(true)
    const chars = CODE.replace(/-/g, '')
    const wrong = SEAT_ALPHABET.split('').find((c) => c !== checkChar(chars.slice(0, 15)))!
    expect(codeFeedback(chars.slice(0, 15) + wrong)).toMatchObject({ state: 'bad', text: 'That code has a typo. Check it and try again.', canConnect: false })
    expect(codeFeedback(chars + 'A').state).toBe('bad')
  })
  it('gate: not switched on = none; unlinked = first; skipped = none; linked + removed = removed', () => {
    expect(connectGate({ ready: false, linked: false, skipped: false, removed: false })).toBe('none')
    expect(connectGate({ ready: true, linked: false, skipped: false, removed: false })).toBe('first')
    expect(connectGate({ ready: true, linked: false, skipped: true, removed: false })).toBe('none')
    expect(connectGate({ ready: true, linked: true, skipped: false, removed: false })).toBe('none')
    expect(connectGate({ ready: true, linked: true, skipped: false, removed: true })).toBe('removed')
  })
})

describe('Phase 269 redeem through the runtime', () => {
  it('happy path: linked, device token kept, first sync is next, password stored nowhere', async () => {
    const w = world(); const p = await linkedPhone(w)
    expect(p.r.ok).toBe(true)
    expect((await getBranchLink(p.db)).linked).toBe(true)
    expect((await p.vault.load())?.deviceToken).toBe(DEVICE_TOKEN)
    expect(p.runtime.engine.state()).toBe('first_sync_needed')
    expect(JSON.stringify(await p.vault.load())).not.toContain(SEAT_PW)
    expect(w.calls).toEqual(['redeem'])
  })
  it('bad code (typo): plain words, no master call', async () => {
    const w = world(); const db = await newDb()
    const runtime = createPhoneSyncRuntime({ db, appVer: '0.1.56', makeTransport: () => new InMemorySharedTransport(w.server), master: w.master })
    const chars = CODE.replace(/-/g, '')
    const wrong = SEAT_ALPHABET.split('').find((c) => c !== checkChar(chars.slice(0, 15)))!
    const r = await runtime.redeem(chars.slice(0, 15) + wrong)
    expect(r).toMatchObject({ ok: false, code: 'Q3M91', message: 'That code has a typo. Check it and try again.' })
    expect(w.calls).toEqual([])
  })
  it('revoked / wrong code: the master answers one plain sentence; nothing is stored', async () => {
    const w = world(); const db = await newDb()
    const runtime = createPhoneSyncRuntime({ db, appVer: '0.1.56', makeTransport: () => new InMemorySharedTransport(w.server), master: w.master })
    w.replies.redeem = [fail(400, 'Q3M01', 'invalid_code')]
    const r = await runtime.redeem(CODE)
    expect(r).toMatchObject({ ok: false, code: 'Q3M01', message: 'That code did not work. Check it and try again.' })
    expect((await getBranchLink(db)).linked).toBe(false)
    expect(await runtime.vault.load()).toBe(null)
  })
  it('offline: "Master unreachable, try again." and nothing stored', async () => {
    const w = world(); const db = await newDb()
    const runtime = createPhoneSyncRuntime({ db, appVer: '0.1.56', makeTransport: () => new InMemorySharedTransport(w.server), master: w.master })
    w.replies.redeem = ['throw', 'throw']
    const r = await runtime.redeem(CODE)
    expect(r).toMatchObject({ ok: false, code: 'Q3M90', message: 'Master unreachable, try again.' })
    expect((await getBranchLink(db)).linked).toBe(false)
  })
  it('the real master is not switched on while its build constants are empty', async () => {
    const db = await newDb()
    const runtime = createPhoneSyncRuntime({ db, appVer: '0.1.56', makeTransport: () => new InMemorySharedTransport(world().server) })
    expect(runtime.masterReady()).toBe(false)
  })
})

describe('Phase 269 silent re-credential in connect()', () => {
  const wire = async (w: ReturnType<typeof world>, nowMs?: () => number) => {
    const p = await linkedPhone(w)
    const port = new InMemorySharedTransport(w.server)
    const recover = createPhoneRecredential({ db: p.db, vault: p.vault, port, master: w.master, nowMs })
    const connection = createPhoneConnect(p.db, p.vault, port, recover)
    w.calls.length = 0
    return { ...p, connection, port }
  }
  it('reset recovery: one refresh, new password signs in, sync connects, no typing', async () => {
    const w = world(); const p = await wire(w)
    w.server.setSeatPassword(SEAT_EMAIL, NEW_PW); w.clock.t += 2 * 3600_000 // the old access token has expired too // the admin reset the seat: every old refresh token is gone
    w.replies.refresh = [w.refreshOk(NEW_PW)]
    const c = await p.connection.connect()
    expect(c.creds.license).toBe(LICENSE)
    expect(w.calls).toEqual(['refresh'])
    const v = await p.vault.load()
    expect(v?.session).toBeTruthy()
    expect(JSON.stringify(v)).not.toContain(NEW_PW)
    expect(await isSeatRemoved(p.db)).toBe(false)
  })
  it('removed seat: the plain words, a flag for the screen, local data and the vault stay', async () => {
    const w = world(); const p = await wire(w)
    w.server.setSeatPassword(SEAT_EMAIL, NEW_PW); w.clock.t += 2 * 3600_000 // the old access token has expired too
    w.replies.refresh = [fail(403, 'Q3M07', 'seat_revoked')]
    await expect(p.connection.connect()).rejects.toMatchObject({ kind: 'auth_failed', message: SEAT_REMOVED_WORDS })
    expect(await isSeatRemoved(p.db)).toBe(true)
    expect((await getBranchLink(p.db)).linked).toBe(true)
    expect((await p.vault.load())?.deviceToken).toBe(DEVICE_TOKEN)
  })
  it('master down: stays "paused, will retry" (not "sign in again"); a retry inside 60 s makes no second call', async () => {
    let t = NOW0
    const w = world(); const p = await wire(w, () => t)
    w.server.setSeatPassword(SEAT_EMAIL, NEW_PW); w.clock.t += 2 * 3600_000 // the old access token has expired too
    w.replies.refresh = ['throw', 'throw']
    await expect(p.connection.connect()).rejects.toMatchObject({ kind: 'offline' })
    const first = w.calls.length
    t += 5_000
    await expect(p.connection.connect()).rejects.toMatchObject({ kind: 'offline' })
    expect(w.calls.length).toBe(first)
    expect((await p.vault.load())?.deviceToken).toBe(DEVICE_TOKEN)
    t += 61_000
    w.replies.refresh = [w.refreshOk(NEW_PW)]
    await expect(p.connection.connect()).resolves.toBeTruthy()
  })
  it('no device token: unchanged behaviour ("Sign in again"), no master call', async () => {
    const w = world(); const p = await wire(w)
    const d = (await p.vault.load())!
    const { deviceToken: _drop, ...old } = d
    await p.vault.save({ ...old, session: null })
    await expect(p.connection.connect()).rejects.toMatchObject({ kind: 'auth_failed', message: 'Sign in again to keep syncing.' })
    expect(w.calls).toEqual([])
  })
  it('a legacy seat (no password) falls back to "Sign in again"', async () => {
    const w = world(); const p = await wire(w)
    w.server.setSeatPassword(SEAT_EMAIL, NEW_PW); w.clock.t += 2 * 3600_000 // the old access token has expired too
    w.replies.refresh = [w.refreshOk(null)]
    await expect(p.connection.connect()).rejects.toMatchObject({ kind: 'auth_failed', message: 'Sign in again to keep syncing.' })
  })
})

describe('Phase 269 screens', () => {
  const api = { ready: () => true, redeem: async () => ({ ok: false as const, code: 'Q3M01' as const, message: 'x' }) }
  it('first launch: one code field, Connect, and the Advanced door to the old form', async () => {
    const db = await newDb()
    const html = renderToStaticMarkup(createElement(ConnectCode, { db, mode: 'first', connect: api, onLinked: () => undefined, onNotNow: () => undefined }))
    expect(html).toContain('Connect to your company')
    expect(html).toContain('aria-label="Company code"')
    expect(html).toContain('Advanced: enter details by hand')
    expect((html.match(/<input/g) ?? []).length).toBe(1) // ONE field until Advanced is opened
  })
  it('seat removed screen says the plain words and keeps the bills', async () => {
    const db = await newDb()
    const html = renderToStaticMarkup(createElement(ConnectCode, { db, mode: 'removed', connect: api, onLinked: () => undefined, onNotNow: () => undefined }))
    expect(html).toContain('This seat was removed')
    expect(html).toContain('Your bills stay on this phone')
  })
})
