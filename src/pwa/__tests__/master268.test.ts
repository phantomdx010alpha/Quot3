import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { generateSeatCode } from '../../shared/master/seatCode'
import { InMemorySharedServer, InMemorySharedTransport } from '../../main/sync/sharedTransport'
import { openPhoneDb } from '../data/db'
import { getMeta } from '../data/metaRepo'
import { getSetting } from '../data/settingsRepo'
import { linkPhoneToOrganisation } from '../sync/branch'
import { adoptIfPossible, createPhoneMasterClient, defaultPhoneBranch, nameVariant, prefixVariant, redeemCode, PHONE_NOT_CONFIGURED_WORDS } from '../sync/master'
import { createSessionVault, VAULT_BLOB_SETTING } from '../sync/session'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange

/** Phase 268: phone master client + redeem. A fake fetch and a fake vault only; invented strings; no real master, no real Supabase. */
const LICENSE = 'Q3-ABCD-EFGH-JKLM'
const URL_ = 'https://example-project.supabase.co'
const ANON = 'invented-anon-key-for-tests'
const MASTER_URL = 'https://master-example.supabase.co'
const MASTER_ANON = 'invented-master-anon-key-for-tests'
const SEAT_PW = 'invented-seat-password-1'
const DEVICE_TOKEN = 'D'.repeat(43)
const CODE = generateSeatCode(Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 3))
const NOW0 = Date.parse('2026-11-14T05:00:00.000Z')

type Reply = { status: number; body: unknown } | 'throw'
interface Call { url: string; headers: Record<string, string>; body: Record<string, unknown> }

function world() {
  const server = new InMemorySharedServer({ now: () => NOW0 })
  const { orgId } = server.addOrg({ licenseKey: LICENSE, seats: [{ email: 'seat1@example.test', password: 'pw-1' }, { email: 'seat2@example.test', password: SEAT_PW }] })
  const calls: Call[] = []
  const replies: Record<string, Reply[]> = {}
  const logs: string[] = []
  const bundle = (over: Record<string, unknown> = {}) => ({
    v: 1, company: { id: 'c1', label: 'Acme' }, supabaseUrl: URL_, anonKey: ANON, license: LICENSE,
    seat: { no: 2, email: 'seat2@example.test', password: SEAT_PW }, profile: null, deviceToken: DEVICE_TOKEN, ...over
  })
  const fetchImpl = async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> })
    const name = url.split('/').pop()!
    const r = replies[name]?.shift()
    if (!r || r === 'throw') throw new Error('network')
    return { status: r.status, text: async () => JSON.stringify(r.body) }
  }
  const master = createPhoneMasterClient({
    url: MASTER_URL, anon: MASTER_ANON, appVersion: '0.1.56', fetchImpl, sleep: async () => undefined,
    log: { info: (m, x) => logs.push(m + JSON.stringify(x ?? '')), warn: (m, x) => logs.push(m + JSON.stringify(x ?? '')) }
  })
  return { server, orgId, calls, replies, logs, bundle, master }
}
async function phone(server: InMemorySharedServer) {
  const db = await openPhoneDb({ factory: new IDBFactory() })
  return { db, port: new InMemorySharedTransport(server), vault: createSessionVault(db) }
}
const ok = (body: unknown): Reply => ({ status: 200, body })

describe('Phase 268 redeemCode', () => {
  it('happy path: one call, branch registered with the defaults, vault holds the device token, password stored nowhere', async () => {
    const w = world(); const p = await phone(w.server)
    w.replies.redeem = [ok({ ok: true, bundle: w.bundle() })]
    const r = await redeemCode({ ...p, master: w.master, deviceLabel: () => 'Pixel' }, CODE.toLowerCase().replace(/-/g, ' '))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.link.linked).toBe(true)
    expect(r.link.branchName).toBe('Phone Acme')
    expect(r.link.poPrefix).toBe('P2')
    expect(r.seatNo).toBe(2)
    expect(w.calls.length).toBe(1)
    expect(w.calls[0]!.url).toBe(`${MASTER_URL}/functions/v1/redeem`)
    expect(w.calls[0]!.body).toEqual({ v: 1, code: CODE, platform: 'phone', deviceLabel: 'Pixel', appVersion: '0.1.56' })
    expect(w.calls[0]!.headers['x-q3-device']).toBe(undefined)
    const v = await p.vault.load()
    expect(v?.deviceToken).toBe(DEVICE_TOKEN)
    expect(v?.session?.userId).toBeTruthy()
    expect(v?.license).toBe(LICENSE)
    expect(JSON.stringify(v)).not.toContain(SEAT_PW)
    const blob = JSON.stringify(await getSetting<unknown>(p.db, VAULT_BLOB_SETTING, null))
    for (const s of [SEAT_PW, DEVICE_TOKEN, 'seat2@example.test']) expect(blob).not.toContain(s)
    expect((await getMeta(p.db)).org_id).toBe(w.orgId)
  })

  it('a typo is refused offline with the typo words and NO call', async () => {
    const w = world(); const p = await phone(w.server)
    const bad = CODE.slice(0, -1) + (CODE.endsWith('A') ? 'B' : 'A')
    const r = await redeemCode({ ...p, master: w.master }, bad)
    expect(r).toEqual({ ok: false, code: 'Q3M91', message: 'That code has a typo. Check it and try again.' })
    expect(w.calls.length).toBe(0)
    expect((await redeemCode({ ...p, master: w.master }, 'abc')).ok).toBe(false)
    expect(w.calls.length).toBe(0)
  })

  it('wrong / revoked / expired codes get the master words and nothing is stored', async () => {
    for (const [code, words] of [['Q3M01', 'That code did not work. Check it and try again.'], ['Q3M07', 'This seat was removed. Ask the admin for a new code.']] as const) {
      const w = world(); const p = await phone(w.server)
      w.replies.redeem = [{ status: 400, body: { ok: false, code, error: 'x', message: words } }]
      const r = await redeemCode({ ...p, master: w.master }, CODE)
      expect(r).toEqual({ ok: false, code, message: words })
      expect(await p.vault.load()).toBe(null)
      expect((await getMeta(p.db)).org_id).toBe(null)
      expect(w.calls.length).toBe(1) // a 4xx is never retried
    }
  })

  it('offline: one retry, then "Master unreachable", nothing stored; a 500 then success works', async () => {
    const w = world(); const p = await phone(w.server)
    w.replies.redeem = ['throw', 'throw']
    const r = await redeemCode({ ...p, master: w.master }, CODE)
    expect(r).toEqual({ ok: false, code: 'Q3M90', message: 'Master unreachable, try again.' })
    expect(w.calls.length).toBe(2)
    expect(await p.vault.load()).toBe(null)
    w.replies.redeem = [{ status: 503, body: {} }, ok({ ok: true, bundle: w.bundle() })]
    expect((await redeemCode({ ...p, master: w.master }, CODE)).ok).toBe(true)
  })

  it('a bundle from the future (v 2) or an unreadable answer is refused', async () => {
    const w = world(); const p = await phone(w.server)
    w.replies.redeem = [ok({ ok: true, bundle: w.bundle({ v: 2 }) })]
    expect((await redeemCode({ ...p, master: w.master }, CODE))).toMatchObject({ ok: false, code: 'Q3M92' })
    w.replies.redeem = [ok({ ok: true, bundle: { nonsense: true } })]
    expect((await redeemCode({ ...p, master: w.master }, CODE))).toMatchObject({ ok: false, code: 'Q3M93' })
    expect(await p.vault.load()).toBe(null)
  })

  it('a build with no master settings makes no call and says so', async () => {
    const w = world(); const p = await phone(w.server)
    const off = createPhoneMasterClient({ url: '', anon: '', appVersion: '0.1.56', fetchImpl: async () => { throw new Error('must not be called') } })
    const r = await redeemCode({ ...p, master: off }, CODE)
    expect(r).toEqual({ ok: false, code: 'Q3M90', message: PHONE_NOT_CONFIGURED_WORDS })
    expect((await adoptIfPossible({ ...p, master: off })).adopted).toBe(false)
  })

  it('no secret reaches the log: code, password, device token', async () => {
    const w = world(); const p = await phone(w.server)
    w.replies.redeem = [ok({ ok: true, bundle: w.bundle() })]
    await redeemCode({ ...p, master: w.master }, CODE)
    const all = w.logs.join('|')
    expect(all).toContain('redeem')
    for (const s of [SEAT_PW, DEVICE_TOKEN, CODE, MASTER_ANON]) expect(all).not.toContain(s)
  })

  it('defaults are plain and within the server limits', () => {
    expect(defaultPhoneBranch({ no: 12 }, '  ')).toEqual({ branchName: 'Phone seat 12', poPrefix: 'P12' })
    expect(defaultPhoneBranch({ no: 3 }, 'x'.repeat(200)).branchName.length).toBe(80)
  })

  it('defect fix: the phone is named after the seat the admin typed; a taken name or prefix gets the next variant', async () => {
    expect(defaultPhoneBranch({ no: 9, label: ' RAHUL   BHAI ' }, 'MB')).toEqual({ branchName: 'RAHUL BHAI', poPrefix: 'P9' })
    expect([nameVariant('RAHUL BHAI', 0), nameVariant('RAHUL BHAI', 1), nameVariant('x'.repeat(80), 2).length]).toEqual(['RAHUL BHAI', 'RAHUL BHAI 2', 80])
    expect([prefixVariant('P9', 0), prefixVariant('P9', 1), prefixVariant('P12345678', 2)]).toEqual(['P9', 'P9A', 'P123456B'])
    const w = world()
    const first = await phone(w.server); const second = await phone(w.server)
    const seat = { no: 2, label: 'RAHUL BHAI', email: 'seat2@example.test', password: SEAT_PW }
    const other = { no: 2, label: 'RAHUL BHAI', email: 'seat1@example.test', password: 'pw-1' } // another login that happens to be named and numbered alike
    w.replies.redeem = [ok({ ok: true, bundle: w.bundle({ seat }) }), ok({ ok: true, bundle: w.bundle({ seat: other }) })]
    const a = await redeemCode({ ...first, master: w.master, deviceLabel: () => 'Pixel' }, CODE)
    const b = await redeemCode({ ...second, master: w.master, deviceLabel: () => 'Samsung' }, CODE)
    expect(a.ok && a.link.branchName).toBe('RAHUL BHAI')
    expect(b.ok).toBe(true)
    if (b.ok) { expect(b.link.branchName).toBe('RAHUL BHAI 2'); expect(b.link.poPrefix).toBe('P2A') }
  })
})

describe('Phase 268 adoptIfPossible (old phones)', () => {
  async function oldPhone(w: ReturnType<typeof world>) {
    const p = await phone(w.server)
    const r = await linkPhoneToOrganisation(p.db, p.port, p.vault, { supabaseUrl: URL_, anonKey: ANON, licenseKey: LICENSE, email: 'seat1@example.test', password: 'pw-1', branchName: 'Old phone', poPrefix: 'OP' }, () => NOW0)
    expect(r.ok).toBe(true)
    return p
  }
  const adoptOk = (token: string | null, existing = false) => ok({ ok: true, deviceToken: token, existing, company: { id: 'c1', label: 'Acme' }, seat: { no: 1, label: 'Main' }, profile: null })

  it('an old blob without a device token still opens, and adopt stores the token and keeps the session', async () => {
    const w = world(); const p = await oldPhone(w)
    const before = await p.vault.load()
    expect(before?.deviceToken).toBe(undefined)
    w.replies.adopt = [adoptOk(DEVICE_TOKEN)]
    expect(await adoptIfPossible({ ...p, master: w.master, nowMs: () => NOW0 - 1000 * 60 })).toEqual({ adopted: true })
    expect(w.calls[0]!.body).toMatchObject({ v: 1, platform: 'phone', supabaseUrl: URL_, accessToken: before!.session!.accessToken })
    const after = await p.vault.load()
    expect(after?.deviceToken).toBe(DEVICE_TOKEN)
    expect(after?.session?.accessToken).toBe(before!.session!.accessToken)
    expect(await adoptIfPossible({ ...p, master: w.master, nowMs: () => NOW0 })).toEqual({ adopted: false, reason: 'has_token' })
    expect(w.calls.length).toBe(1)
  })

  it('silent on every failure: offline, master refusal, no token issued, expired session, not linked', async () => {
    const w = world(); const p = await oldPhone(w)
    const t = () => NOW0 - 1000 * 60
    w.replies.adopt = ['throw', 'throw']
    expect(await adoptIfPossible({ ...p, master: w.master, nowMs: t })).toEqual({ adopted: false, reason: 'failed', message: 'Master unreachable, try again.' })
    w.replies.adopt = [{ status: 401, body: { ok: false, code: 'Q3M14', error: 'x', message: 'x' } }]
    expect((await adoptIfPossible({ ...p, master: w.master, nowMs: t })).adopted).toBe(false)
    w.replies.adopt = [adoptOk(null, true)]
    expect(await adoptIfPossible({ ...p, master: w.master, nowMs: t })).toEqual({ adopted: false, reason: 'no_token_issued' })
    const calls = w.calls.length
    expect(await adoptIfPossible({ ...p, master: w.master, nowMs: () => NOW0 + 10 * 24 * 3600 * 1000 })).toEqual({ adopted: false, reason: 'session_expired' })
    expect(w.calls.length).toBe(calls)
    expect((await p.vault.load())?.session).not.toBe(null) // a failed adopt never signs the phone out
    const fresh = await phone(w.server)
    expect(await adoptIfPossible({ ...fresh, master: w.master })).toEqual({ adopted: false, reason: 'not_linked' })
  })

  it('linking again through the old form keeps the device token', async () => {
    const w = world(); const p = await oldPhone(w)
    w.replies.adopt = [adoptOk(DEVICE_TOKEN)]
    await adoptIfPossible({ ...p, master: w.master, nowMs: () => NOW0 - 60_000 })
    const r = await linkPhoneToOrganisation(p.db, p.port, p.vault, { supabaseUrl: URL_, anonKey: ANON, licenseKey: LICENSE, email: 'seat1@example.test', password: 'pw-1', branchName: 'Old phone', poPrefix: 'OP' }, () => NOW0)
    expect(r.ok).toBe(true)
    expect((await p.vault.load())?.deviceToken).toBe(DEVICE_TOKEN)
  })
})
