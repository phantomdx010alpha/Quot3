import { describe, expect, it } from 'vitest'
import { MASTER_ERRORS, masterErrorWords } from '../../../../shared/master/errors'
import { generateSeatCode } from '../../../../shared/master/seatCode'
import type { SecretStore } from '../../secretStore'
import { createMasterClient, MasterError, type MasterClientDeps } from '../masterClient'
import { createMasterService, type MasterServiceDeps } from '../masterService'
import { createMasterStore, type MasterKv } from '../masterStore'

const URL = 'https://masterref0000.supabase.co'
const ANON = 'anon-key-for-tests-0123456789'
const TOKEN = 'T'.repeat(43)
const TOKEN2 = 'U'.repeat(43)
const LICENSE = 'Q3-ABCD-EFGH-JKLM'
const SERVICE_ROLE = 'service-role-key-must-never-be-kept-1234567890'
const ENROL = 'enrol-token-must-never-be-kept-1234567890'
const PASSWORD = 'seat-password-must-never-be-kept'
const iso = '2026-11-13T10:00:00.000Z'
const profile = { version: 3, name: 'Acme', phone: '', address: '', logo: null }
const seatView = (no: number, over: Record<string, unknown> = {}) => ({ no, label: `Seat ${no}`, email: `s${no}@x.test`, status: 'active', legacy: false, code: null, codeHint: 'ABCD', createdAt: iso, resetAt: null, devices: 1, lastSeenAt: null, ...over })
const bundle = (over: Record<string, unknown> = {}) => ({ v: 1, company: { id: 'c1', label: 'Acme' }, supabaseUrl: 'https://comp.supabase.co', anonKey: ANON, license: LICENSE, seat: { no: 2, email: 's2@x.test', password: PASSWORD }, profile, deviceToken: TOKEN, ...over })

interface Call { url: string; headers: Record<string, string>; body: Record<string, unknown> }
type Reply = { status: number; json?: unknown; text?: string } | 'network'
/** A scripted fetch: each call takes the next reply (the last one repeats). */
function fakeFetch(replies: Reply[]) {
  const calls: Call[] = []
  const fetchImpl: MasterClientDeps['fetchImpl'] = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) })
    const r = replies[Math.min(calls.length - 1, replies.length - 1)]!
    if (r === 'network') throw new Error('offline')
    return { status: r.status, text: async () => r.text ?? JSON.stringify(r.json ?? {}) }
  }
  return { calls, fetchImpl }
}
const okJson = (extra: Record<string, unknown>): Reply => ({ status: 200, json: { ok: true, ...extra } })
const errJson = (code: keyof typeof MASTER_ERRORS): Reply => ({ status: MASTER_ERRORS[code].http || 400, json: { ok: false, code, error: MASTER_ERRORS[code].error, message: MASTER_ERRORS[code].message } })
const logs: unknown[] = []
const log = { info: (m: string, meta?: unknown) => { logs.push([m, meta]) }, warn: (m: string, meta?: unknown) => { logs.push([m, meta]) } }
const client = (replies: Reply[]) => { const f = fakeFetch(replies); return { ...f, client: createMasterClient({ url: URL, anon: ANON, fetchImpl: f.fetchImpl, log, sleep: async () => undefined }) } }

function memKv(): MasterKv & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return { map, get: (k) => map.get(k), set: (k, v) => void map.set(k, v), setMany: (e) => { for (const [k, v] of Object.entries(e)) map.set(k, v) }, remove: (ks) => { for (const k of ks) map.delete(k) }, keys: (p) => [...map.keys()].filter((k) => k.startsWith(p)) }
}
const secrets: SecretStore = { available: () => true, encrypt: (p) => `ENC(${Buffer.from(p).toString('base64')})`, decrypt: (b) => Buffer.from(b.slice(4, -1), 'base64').toString() }

function setup(replies: Reply[], over: Partial<MasterServiceDeps> = {}, linked = true) {
  const f = client(replies); const kv = memKv(); const store = createMasterStore({ kv, secrets })
  if (linked) store.save({ deviceToken: TOKEN, companyId: 'c1', companyLabel: 'Acme', seatNo: 1, seatLabel: 'Seat 1', profileVersion: 3 })
  let n = 0
  const svc = createMasterService({
    client: f.client, store, config: { url: URL, anon: ANON },
    company: { credentials: () => ({ url: 'https://comp.supabase.co', anonKey: ANON, license: LICENSE }), accessToken: async () => 'company-access-token-xyz' },
    appVersion: '0.1.56', deviceLabel: () => 'PC-1', newReqId: () => `req-${++n}`, log, ...over
  })
  return { ...f, kv, store, svc }
}

describe('masterClient (Phase 263)', () => {
  it('posts to /functions/v1/<name> with v:1, the anon headers and the device header', async () => {
    const { client: c, calls } = client([okJson({ profile })])
    await c.profileGet(TOKEN)
    expect(calls[0]!.url).toBe(`${URL}/functions/v1/profile-get`)
    expect(calls[0]!.headers).toMatchObject({ apikey: ANON, authorization: `Bearer ${ANON}`, 'content-type': 'application/json', 'x-q3-device': TOKEN })
    expect(calls[0]!.body).toEqual({ v: 1 })
    const r = client([okJson({ bundle: bundle() })]); await r.client.redeem({ code: 'Q3C-X', platform: 'desktop', appVersion: '1' })
    expect(r.calls[0]!.headers['x-q3-device']).toBeUndefined()
  })
  it('every one of the 13 calls uses its path and body', async () => {
    const seatOk = okJson({ seat: seatView(2) })
    const table: Array<[string, (c: ReturnType<typeof client>['client']) => Promise<unknown>, Reply, Record<string, unknown>]> = [
      ['redeem', (c) => c.redeem({ code: 'Q3C-X', platform: 'desktop', appVersion: '1' }), okJson({ bundle: bundle() }), { code: 'Q3C-X', platform: 'desktop', appVersion: '1' }],
      ['adopt', (c) => c.adopt({ supabaseUrl: 'https://comp.supabase.co', accessToken: 'tok-123', platform: 'desktop', appVersion: '1' }), okJson({ deviceToken: TOKEN, existing: false, company: { id: 'c1', label: 'Acme' }, seat: { no: 2, label: 'Seat 2' }, profile }), { supabaseUrl: 'https://comp.supabase.co', accessToken: 'tok-123', platform: 'desktop', appVersion: '1' }],
      ['refresh', (c) => c.refresh(TOKEN), okJson({ supabaseUrl: 'https://comp.supabase.co', anonKey: ANON, license: LICENSE, seat: { no: 2, email: 's2@x.test', password: null }, legacy: true }), {}],
      ['heartbeat', (c) => c.heartbeat({ profileVersion: 3, appVersion: '1' }, TOKEN), okJson({ profileVersion: 3, profileChanged: false, seat: { no: 1, label: 'Seat 1', status: 'active' }, company: { status: 'active' }, serverTime: iso }), { profileVersion: 3, appVersion: '1' }],
      ['profile-get', (c) => c.profileGet(TOKEN), okJson({ profile }), {}],
      ['profile-set', (c) => c.profileSet({ reqId: 'r1', name: 'A', phone: '', address: '' }, TOKEN), okJson({ profile }), { reqId: 'r1', name: 'A', phone: '', address: '' }],
      ['seat-list', (c) => c.seatList(TOKEN), okJson({ company: { id: 'c1', label: 'Acme', maxSeats: 15, status: 'active' }, seats: [seatView(1)] }), {}],
      ['seat-create', (c) => c.seatCreate({ reqId: 'r1', label: 'Shop' }, TOKEN), seatOk, { reqId: 'r1', label: 'Shop' }],
      ['seat-reset', (c) => c.seatReset({ reqId: 'r1', seatNo: 2 }, TOKEN), seatOk, { reqId: 'r1', seatNo: 2 }],
      ['seat-revoke', (c) => c.seatRevoke({ reqId: 'r1', seatNo: 2 }, TOKEN), seatOk, { reqId: 'r1', seatNo: 2 }],
      ['seat-rename', (c) => c.seatRename({ seatNo: 2, label: 'Shop' }, TOKEN), seatOk, { seatNo: 2, label: 'Shop' }],
      ['seat-regen', (c) => c.seatRegen({ reqId: 'r1', seatNo: 2 }, TOKEN), seatOk, { reqId: 'r1', seatNo: 2 }],
      ['enrol', (c) => c.enrol({ enrolToken: ENROL, label: 'Acme', supabaseUrl: 'https://comp.supabase.co', anonKey: ANON, license: LICENSE, accessToken: 'tok-123', serviceRoleKey: SERVICE_ROLE, platform: 'desktop', appVersion: '1' }), okJson({ deviceToken: TOKEN, company: { id: 'c1', label: 'Acme' }, seats: 3, profile }), {}]
    ]
    for (const [name, run, reply, body] of table) {
      const { client: c, calls } = client([reply])
      await run(c)
      expect(calls.length, name).toBe(1)
      expect(calls[0]!.url, name).toBe(`${URL}/functions/v1/${name}`)
      expect(calls[0]!.body, name).toMatchObject({ v: 1, ...body })
    }
  })
  it('retries ONCE on a network error or a 5xx, never after a 4xx', async () => {
    let r = client(['network', okJson({ profile })]); await r.client.profileGet(TOKEN); expect(r.calls.length).toBe(2)
    r = client([{ status: 503, text: 'bad gateway' }, okJson({ profile })]); await r.client.profileGet(TOKEN); expect(r.calls.length).toBe(2)
    r = client([errJson('Q3M04'), okJson({ profile })])
    await expect(r.client.profileGet(TOKEN)).rejects.toMatchObject({ code: 'Q3M04' }); expect(r.calls.length).toBe(1)
    r = client([{ status: 500, json: { ok: false, code: 'Q3M99', error: 'internal', message: 'x' } }])
    await expect(r.client.profileGet(TOKEN)).rejects.toMatchObject({ code: 'Q3M99' }); expect(r.calls.length).toBe(2)
  })
  it('offline is "Master unreachable, try again." (Q3M90) after the one retry', async () => {
    const r = client(['network'])
    const e = await r.client.seatList(TOKEN).catch((x: unknown) => x) as MasterError
    expect(e).toBeInstanceOf(MasterError); expect(e.code).toBe('Q3M90'); expect(e.message).toBe('Master unreachable, try again.'); expect(r.calls.length).toBe(2)
  })
  it('unreadable answers are Q3M93; a bundle with another version is Q3M92 (T31)', async () => {
    await expect(client([{ status: 200, text: 'not json' }]).client.profileGet(TOKEN)).rejects.toMatchObject({ code: 'Q3M93' })
    await expect(client([okJson({ profile: { version: 'x' } })]).client.profileGet(TOKEN)).rejects.toMatchObject({ code: 'Q3M93' })
    const red = (b: unknown) => client([okJson({ bundle: b })]).client.redeem({ code: 'Q3C-X', platform: 'desktop', appVersion: '1' })
    await expect(red(bundle({ v: 2 }))).rejects.toMatchObject({ code: 'Q3M92' })
    await expect(red(bundle({ license: 'nope' }))).rejects.toMatchObject({ code: 'Q3M93' })
    expect((await red(bundle())).deviceToken).toBe(TOKEN)
  })
  it('every Q3M code a server sends turns into the same words the table holds (T34)', async () => {
    for (const code of Object.keys(MASTER_ERRORS).filter((c) => MASTER_ERRORS[c as keyof typeof MASTER_ERRORS].http !== 0) as Array<keyof typeof MASTER_ERRORS>) {
      const e = await client([errJson(code)]).client.seatList(TOKEN).catch((x: unknown) => x) as MasterError
      expect(e.code).toBe(code); expect(e.message).toBe(masterErrorWords(code))
    }
  })
  it('logs name the function and the outcome only, never a token, body or password (T28)', async () => {
    logs.length = 0
    const r = client([okJson({ bundle: bundle() })]); await r.client.redeem({ code: generateSeatCode(new Uint8Array(15).fill(3)), platform: 'desktop', appVersion: '1' })
    await client([errJson('Q3M04')]).client.seatList(TOKEN).catch(() => undefined)
    const text = JSON.stringify(logs)
    for (const bad of [TOKEN, PASSWORD, LICENSE, ANON, 'Q3C-']) expect(text).not.toContain(bad)
    expect(text).toContain('redeem')
  })
})

describe('masterStore', () => {
  it('keeps the device token wrapped, reads it back, and clear() removes every master key', () => {
    const kv = memKv(); const s = createMasterStore({ kv, secrets })
    expect(s.link()).toBeNull()
    s.save({ deviceToken: TOKEN, companyId: 'c1', companyLabel: 'Acme', seatNo: 2, seatLabel: 'Shop', profileVersion: null })
    expect(kv.map.get('master.deviceToken')).not.toContain(TOKEN)
    expect(s.link()).toEqual({ deviceToken: TOKEN, companyId: 'c1', companyLabel: 'Acme', seatNo: 2, seatLabel: 'Shop', profileVersion: null })
    s.setProfileVersion(4); s.setLastError('words'); expect(s.link()?.profileVersion).toBe(4); expect(s.lastError()).toBe('words')
    s.clear(); expect(kv.keys('master.')).toEqual([]); expect(s.link()).toBeNull()
  })
  it('a token that cannot be decrypted (another Windows user) means "not linked"', () => {
    const kv = memKv(); createMasterStore({ kv, secrets }).save({ deviceToken: TOKEN, companyId: 'c1', companyLabel: 'A', seatNo: 1, seatLabel: 'Seat 1', profileVersion: 0 })
    expect(createMasterStore({ kv, secrets: { ...secrets, decrypt: () => { throw new Error('no') } } }).link()).toBeNull()
  })
})

describe('masterService', () => {
  it('T21: a build with no master settings never makes a call, whatever is invoked', async () => {
    const s = setup([okJson({ profile })], { config: { url: '', anon: '' } })
    expect(s.svc.status()).toMatchObject({ configured: false, linked: true })
    expect((await s.svc.adopt()).adopted).toBe(false)
    expect(await s.svc.heartbeat()).toMatchObject({ ok: false }); expect(await s.svc.refreshCredentials()).toMatchObject({ ok: false })
    for (const run of [() => s.svc.seatList(), () => s.svc.profileGet(), () => s.svc.seatCreate({ label: 'A' }), () => s.svc.link({ enrolToken: ENROL, label: 'A', serviceRoleKey: SERVICE_ROLE }), () => s.svc.redeem({ code: generateSeatCode(new Uint8Array(15).fill(5)) })]) {
      await expect(run()).rejects.toMatchObject({ code: expect.stringMatching(/IO_ERROR|VALIDATION/) })
    }
    expect(s.calls.length).toBe(0)
  })
  it('a service with no linked company makes no admin call and says so in plain words', async () => {
    const s = setup([okJson({ profile })], {}, false)
    await expect(s.svc.seatList()).rejects.toMatchObject({ code: 'VALIDATION', details: { code: 'Q3M15' } }); expect(s.calls.length).toBe(0)
    expect((await s.svc.heartbeat()).ok).toBe(false); expect(s.calls.length).toBe(0)
  })
  it('link: sends the company session, stores only the device token and labels, forgets the service_role key (T29)', async () => {
    logs.length = 0
    const s = setup([okJson({ deviceToken: TOKEN, company: { id: 'c1', label: 'Acme' }, seats: 3, profile })], {}, false)
    const st = await s.svc.link({ enrolToken: ENROL, label: 'Acme', serviceRoleKey: SERVICE_ROLE })
    expect(st).toMatchObject({ configured: true, linked: true, companyLabel: 'Acme', seatNo: 1, isAdmin: true })
    expect(s.calls[0]!.body).toMatchObject({ enrolToken: ENROL, serviceRoleKey: SERVICE_ROLE, accessToken: 'company-access-token-xyz', supabaseUrl: 'https://comp.supabase.co', license: LICENSE })
    const everything = JSON.stringify([...s.kv.map.entries(), st, logs])
    for (const bad of [SERVICE_ROLE, ENROL, TOKEN, 'company-access-token-xyz', LICENSE]) expect(everything).not.toContain(bad)
    expect(s.store.link()?.deviceToken).toBe(TOKEN)
  })
  it('link refuses without a company sign-in and passes the master refusal in words', async () => {
    const none = setup([okJson({})], { company: { credentials: () => null, accessToken: async () => null } }, false)
    await expect(none.svc.link({ enrolToken: ENROL, label: 'A', serviceRoleKey: SERVICE_ROLE })).rejects.toMatchObject({ code: 'VALIDATION' }); expect(none.calls.length).toBe(0)
    const bad = setup([errJson('Q3M16')], {}, false)
    await expect(bad.svc.link({ enrolToken: ENROL, label: 'A', serviceRoleKey: SERVICE_ROLE })).rejects.toMatchObject({ message: 'That setup token is wrong, used or expired.', details: { code: 'Q3M16' } })
    expect(bad.svc.status().lastError).toBe('That setup token is wrong, used or expired.'); expect(bad.svc.status().linked).toBe(false)
  })
  it('redeem: a typo is refused offline (Q3M91, no call); a good code goes through applyBundle then is stored', async () => {
    const applied: unknown[] = []
    const s = setup([okJson({ bundle: bundle() })], { applyBundle: async (b) => { applied.push(b.seat.no) } }, false)
    const good = generateSeatCode(new Uint8Array(15).fill(9))
    const typo = good.slice(0, -1) + (good.endsWith('A') ? 'B' : 'A')
    await expect(s.svc.redeem({ code: typo })).rejects.toMatchObject({ details: { code: 'Q3M91' }, message: 'That code has a typo. Check it and try again.' })
    expect(s.calls.length).toBe(0)
    const code = good
    const st = await s.svc.redeem({ code: code.toLowerCase().replace(/-/g, ' ') })
    expect(applied).toEqual([2]); expect(st).toMatchObject({ linked: true, seatNo: 2, isAdmin: false })
    expect(s.calls[0]!.body).toMatchObject({ code, platform: 'desktop', deviceLabel: 'PC-1' })
    expect(JSON.stringify([...s.kv.map.entries(), st])).not.toContain(PASSWORD)
  })
  it('redeem without an applyBundle port makes no call (nothing is wasted on the master)', async () => {
    const s = setup([okJson({ bundle: bundle() })], {}, false)
    await expect(s.svc.redeem({ code: generateSeatCode(new Uint8Array(15).fill(9)) })).rejects.toMatchObject({ code: 'IO_ERROR' }); expect(s.calls.length).toBe(0)
  })
  it('T22 / T24: adopt is silent: unreachable master changes nothing and throws nothing', async () => {
    const s = setup(['network'])
    const before = JSON.stringify([...s.kv.map.entries()].filter(([k]) => k !== 'master.lastError'))
    const r = await s.svc.adopt()
    expect(r.adopted).toBe(false); expect(r.error).toMatchObject({ code: 'Q3M90', message: 'Master unreachable, try again.' })
    expect(JSON.stringify([...s.kv.map.entries()].filter(([k]) => k !== 'master.lastError'))).toBe(before)
    expect(s.svc.status().lastError).toBe('Master unreachable, try again.')
  })
  it('adopt: stores the new device token; an existing link sends its token and keeps it; "not registered" is not an error', async () => {
    const s = setup([okJson({ deviceToken: TOKEN2, existing: false, company: { id: 'c9', label: 'Beta' }, seat: { no: 3, label: 'Seat 3' }, profile })], {}, false)
    const r = await s.svc.adopt()
    expect(r).toMatchObject({ adopted: true, error: null }); expect(s.store.link()).toMatchObject({ deviceToken: TOKEN2, companyLabel: 'Beta', seatNo: 3 })
    expect(s.calls[0]!.headers['x-q3-device']).toBeUndefined(); expect(s.calls[0]!.body).toMatchObject({ supabaseUrl: 'https://comp.supabase.co', accessToken: 'company-access-token-xyz' })
    const known = setup([okJson({ deviceToken: null, existing: true, company: { id: 'c1', label: 'Acme' }, seat: { no: 1, label: 'Boss' }, profile })])
    await known.svc.adopt(); expect(known.calls[0]!.headers['x-q3-device']).toBe(TOKEN); expect(known.store.link()).toMatchObject({ deviceToken: TOKEN, seatLabel: 'Boss', profileVersion: 3 })
    const unreg = setup([errJson('Q3M15')], {}, false); expect(await unreg.svc.adopt()).toMatchObject({ adopted: false, error: null }); expect(unreg.svc.status().lastError).toBe('')
    const none = setup([okJson({})], { company: { credentials: () => null, accessToken: async () => null } }, false); await none.svc.adopt(); expect(none.calls.length).toBe(0)
  })
  it('refreshCredentials hands a known password to the port only; a legacy seat is reported, not applied (T25)', async () => {
    const got: unknown[] = []
    const refresh = (password: string | null, legacy: boolean): Reply => okJson({ supabaseUrl: 'https://comp.supabase.co', anonKey: ANON, license: LICENSE, seat: { no: 2, email: 's2@x.test', password }, legacy })
    const a = setup([refresh(PASSWORD, false)], { applyCredentials: async (c) => { got.push(c.seat.password) } })
    expect(await a.svc.refreshCredentials()).toEqual({ ok: true, legacy: false, applied: true }); expect(got).toEqual([PASSWORD])
    expect(JSON.stringify(await setup([refresh(PASSWORD, false)], { applyCredentials: async () => undefined }).svc.refreshCredentials())).not.toContain(PASSWORD)
    const b = setup([refresh(null, true)], { applyCredentials: async (c) => { got.push(c) } })
    expect(await b.svc.refreshCredentials()).toEqual({ ok: true, legacy: true, applied: false }); expect(got.length).toBe(1)
    const gone = setup([errJson('Q3M07')]); expect(await gone.svc.refreshCredentials()).toMatchObject({ ok: false, code: 'Q3M07', message: 'This seat was removed. Ask the admin for a new code.' })
  })
  it('heartbeat: sends the stored profile version; a newer profile goes to the port and the version is stored (T32 input)', async () => {
    const applied: number[] = []
    const hb = (changed: boolean, status = 'active'): Reply => okJson({ profileVersion: changed ? 4 : 3, profileChanged: changed, seat: { no: 1, label: 'Seat 1', status }, company: { status: 'active' }, serverTime: iso })
    const s = setup([hb(true), okJson({ profile: { ...profile, version: 4 } })], { applyProfile: async (p) => { applied.push(p.version) } })
    expect(await s.svc.heartbeat()).toMatchObject({ ok: true, profileChanged: true, profileApplied: true })
    expect(s.calls[0]!.body).toMatchObject({ profileVersion: 3, appVersion: '0.1.56' }); expect(applied).toEqual([4]); expect(s.store.link()?.profileVersion).toBe(4)
    const noPort = setup([hb(true)]); expect(await noPort.svc.heartbeat()).toMatchObject({ profileChanged: true, profileApplied: false }); expect(noPort.store.link()?.profileVersion).toBe(3)
    const removed = setup([hb(false, 'revoked')]); await removed.svc.heartbeat(); expect(removed.svc.status().lastError).toBe('This seat was removed. Ask the admin for a new code.')
  })
  it('seat admin and profile calls use the device token, a fresh reqId each time, and return the SeatView', async () => {
    const s = setup([okJson({ seat: seatView(2, { code: 'Q3C-AAAA-BBBB-CCCC-DDDD' }) })])
    expect((await s.svc.seatCreate({ label: 'Shop' })).code).toBe('Q3C-AAAA-BBBB-CCCC-DDDD')
    await s.svc.seatReset({ seatNo: 2 }); await s.svc.seatRevoke({ seatNo: 2 }); await s.svc.seatRegen({ seatNo: 2 }); await s.svc.seatRename({ seatNo: 2, label: 'X' })
    expect(s.calls.map((c) => c.url.split('/').pop())).toEqual(['seat-create', 'seat-reset', 'seat-revoke', 'seat-regen', 'seat-rename'])
    expect(s.calls.every((c) => c.headers['x-q3-device'] === TOKEN)).toBe(true)
    expect(s.calls.slice(0, 4).map((c) => c.body.reqId)).toEqual(['req-1', 'req-2', 'req-3', 'req-4']); expect(s.calls[4]!.body.reqId).toBeUndefined()
  })
  it('a master refusal becomes an AppError with the words and the code; offline keeps everything else working', async () => {
    const admin = setup([errJson('Q3M05')]); await expect(admin.svc.seatList()).rejects.toMatchObject({ code: 'AUTH_FAILED', message: 'Only the admin seat (seat 1) can do this.', details: { code: 'Q3M05' } })
    const off = setup(['network']); await expect(off.svc.seatCreate({ label: 'A' })).rejects.toMatchObject({ code: 'SYNC_OFFLINE', message: 'Master unreachable, try again.' })
    expect(off.svc.status().linked).toBe(true)
    const ok = setup([errJson('Q3M08'), okJson({ seat: seatView(2) })]); await ok.svc.seatCreate({ label: 'A' }).catch(() => undefined); await ok.svc.seatList().catch(() => undefined)
  })
  it('profileSet: too-large text is refused before any call (Q3M18); success stores the new version', async () => {
    const s = setup([okJson({ profile: { ...profile, version: 5 } })])
    await expect(s.svc.profileSet({ name: 'x'.repeat(201), phone: '', address: '' })).rejects.toMatchObject({ details: { code: 'Q3M18' } }); expect(s.calls.length).toBe(0)
    await s.svc.profileSet({ name: 'A', phone: '1', address: 'B', logo: null, expectVersion: 3 })
    expect(s.calls[0]!.body).toMatchObject({ name: 'A', logo: null, expectVersion: 3, reqId: 'req-1' }); expect(s.store.link()?.profileVersion).toBe(5)
  })
  it('T28: status and every outcome stay free of tokens, passwords and codes', async () => {
    const s = setup([okJson({ supabaseUrl: 'https://comp.supabase.co', anonKey: ANON, license: LICENSE, seat: { no: 2, email: 's2@x.test', password: PASSWORD }, legacy: false })], { applyCredentials: async () => undefined })
    const text = JSON.stringify([s.svc.status(), await s.svc.refreshCredentials(), s.svc.status()])
    for (const bad of [TOKEN, PASSWORD, LICENSE, ANON]) expect(text).not.toContain(bad)
  })
})
