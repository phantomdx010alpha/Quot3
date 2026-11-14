import { describe, expect, it } from 'vitest'
import { handleAdopt } from '../../../supabase/master/functions/adopt/handler'
import { handleHeartbeat } from '../../../supabase/master/functions/heartbeat/handler'
import { handleProfileGet } from '../../../supabase/master/functions/profile-get/handler'
import { handleRedeem } from '../../../supabase/master/functions/redeem/handler'
import { handleRefresh } from '../../../supabase/master/functions/refresh/handler'
import { aadSeatPassword } from '../../../supabase/master/functions/_shared/aad'
import { MASTER_ERRORS } from '../../shared/master/errors'
import { BundleSchema } from '../../shared/master/schemas'
import { sealText } from '../../shared/master/seal'
import { COMPANY_ID, COMPANY_URL, KEK, LICENSE, ORIGIN, post, seedCompany, seedSeat, sha256Hex, world, type World } from './fakes'

const REDEEM = { v: 1, platform: 'phone', deviceLabel: 'Counter phone', appVersion: '0.1.56' }
const ADOPT = (accessToken = 'jwt-ok') => ({ v: 1, supabaseUrl: COMPANY_URL, accessToken, platform: 'desktop', appVersion: '0.1.56' })
const j = async (r: Response) => (await r.json()) as any

async function ready(): Promise<{ w: World; s1: Awaited<ReturnType<typeof seedSeat>>; s2: Awaited<ReturnType<typeof seedSeat>> }> {
  const w = world()
  await seedCompany(w)
  const s1 = await seedSeat(w, 1)
  const s2 = await seedSeat(w, 2)
  return { w, s1, s2 }
}
async function redeemToken(w: World, code: string): Promise<string> {
  return (await j(await handleRedeem(post('redeem', { ...REDEEM, code }), w.deps))).bundle.deviceToken
}
const withDevice = (token: string) => ({ 'x-q3-device': token })

describe('T1 redeem', () => {
  it('a good code returns a valid Bundle and a new device row; the code works a second time', async () => {
    const { w, s2 } = await ready()
    const res = await handleRedeem(post('redeem', { ...REDEEM, code: s2.code }), w.deps)
    expect(res.status).toBe(200)
    const body = await j(res)
    expect(body.ok).toBe(true)
    expect(BundleSchema.safeParse(body.bundle).success).toBe(true)
    expect(body.bundle).toMatchObject({
      v: 1, company: { id: COMPANY_ID, label: 'Shop A' }, supabaseUrl: COMPANY_URL, license: LICENSE,
      seat: { no: 2, email: 'seat2@shop.invalid', password: s2.password }, profile: { version: 0, name: 'Shop A', logo: null }
    })
    expect(w.master.devices).toHaveLength(1)
    // only the HASH of the device token is stored
    expect(w.master.devices[0]!.token_hash).toBe(await sha256Hex(body.bundle.deviceToken))
    expect(JSON.stringify(w.master.devices)).not.toContain(body.bundle.deviceToken)
    expect(w.master.devices[0]).toMatchObject({ seat_no: 2, platform: 'phone', label: 'Counter phone' })
    const again = await j(await handleRedeem(post('redeem', { ...REDEEM, code: s2.code.toLowerCase().replace(/-/g, ' ') }), w.deps))
    expect(again.ok).toBe(true)
    expect(w.master.devices).toHaveLength(2)
    expect(again.bundle.deviceToken).not.toBe(body.bundle.deviceToken)
  })
})

describe('T2 redeem failures', () => {
  it('wrong, malformed, revoked and regenerated codes give the IDENTICAL Q3M01 body', async () => {
    const { w, s2 } = await ready()
    const rev = await seedSeat(w, 3, { status: 'revoked', randomSeed: 9 })
    const old = await seedSeat(w, 4, { randomSeed: 17 }) // pretend seat 4 was regenerated: its old code is simply no longer stored
    w.master.seats.find((s) => s.seat_no === 4)!.code_hash = 'f'.repeat(64)
    const bodies = [] as string[]
    for (const code of ['Q3C-ABCD-EFGH-IJKL-MNOE', 'nonsense', rev.code, old.code, s2.code.slice(0, -1) + 'X']) {
      const r = await handleRedeem(post('redeem', { ...REDEEM, code }, {}, `198.51.100.${bodies.length}`), w.deps)
      expect(r.status).toBe(400)
      bodies.push(await r.text())
    }
    expect(new Set(bodies).size).toBe(1)
    expect(JSON.parse(bodies[0]!)).toEqual({ ok: false, code: 'Q3M01', error: 'invalid_code', message: MASTER_ERRORS.Q3M01.message })
    expect(w.master.devices).toHaveLength(0)
  })

  it('a suspended company with a MATCHING code -> Q3M06', async () => {
    const w = world()
    await seedCompany(w, { status: 'suspended' })
    const s = await seedSeat(w, 2)
    const r = await handleRedeem(post('redeem', { ...REDEEM, code: s.code }), w.deps)
    expect(r.status).toBe(403)
    expect((await j(r)).code).toBe('Q3M06')
    expect(w.master.devices).toHaveLength(0)
  })

  it('a legacy seat can never match; a wire version other than 1 -> Q3M19; a bad shape -> Q3M03', async () => {
    const { w, s2 } = await ready()
    expect((await j(await handleRedeem(post('redeem', { ...REDEEM, v: 2, code: s2.code }), w.deps))).code).toBe('Q3M19')
    expect((await j(await handleRedeem(post('redeem', { v: 1, code: s2.code }), w.deps))).code).toBe('Q3M03')
    expect((await j(await handleRedeem(post('redeem', { ...REDEEM, platform: 'tv', code: s2.code }), w.deps))).code).toBe('Q3M03')
  })
})

describe('T3 rate limit', () => {
  it('the 11th failure from one ip within 15 minutes -> Q3M02; successes do not count; the window ends', async () => {
    const { w, s2 } = await ready()
    // successes never count
    for (let i = 0; i < 12; i++) expect((await handleRedeem(post('redeem', { ...REDEEM, code: s2.code }), w.deps)).status).toBe(200)
    for (let i = 0; i < 10; i++) {
      const r = await handleRedeem(post('redeem', { ...REDEEM, code: 'Q3C-ABCD-EFGH-IJKL-MNOE' }), w.deps)
      expect((await j(r)).code).toBe('Q3M01')
    }
    const blocked = await handleRedeem(post('redeem', { ...REDEEM, code: 'Q3C-ABCD-EFGH-IJKL-MNOE' }), w.deps)
    expect(blocked.status).toBe(429)
    expect((await j(blocked)).code).toBe('Q3M02')
    // even a CORRECT code is held back while blocked, but another ip is not affected
    expect((await j(await handleRedeem(post('redeem', { ...REDEEM, code: s2.code }), w.deps))).code).toBe('Q3M02')
    expect((await handleRedeem(post('redeem', { ...REDEEM, code: s2.code }, {}, '198.51.100.99'), w.deps)).status).toBe(200)
    // after 15 minutes the window is clear
    w.clock.t += 15 * 60 * 1000 + 1000
    expect((await handleRedeem(post('redeem', { ...REDEEM, code: s2.code }), w.deps)).status).toBe(200)
  })

  it('the ip is stored only as a salted hash', async () => {
    const { w } = await ready()
    await handleRedeem(post('redeem', { ...REDEEM, code: 'nonsense' }, {}, '203.0.113.7'), w.deps)
    expect(w.master.attempts[0]!.ip).toBe(await sha256Hex('203.0.113.7' + 'test-pepper'))
    expect(JSON.stringify(w.master.attempts)).not.toContain('203.0.113.7')
  })
})

describe('T4 / T5 adopt', () => {
  it('a valid session returns a device token, maps the seat, changes no password; a repeat returns existing:true', async () => {
    const { w, s2 } = await ready()
    w.company.sessions.set('jwt-ok', { id: 'user-2', email: 'seat2@shop.invalid' })
    const before = JSON.stringify(w.master.seats)
    const first = await j(await handleAdopt(post('adopt', ADOPT()), w.deps))
    expect(first).toMatchObject({ ok: true, existing: false, company: { id: COMPANY_ID, label: 'Shop A' }, seat: { no: 2, label: 'Seat 2' } })
    expect(first.deviceToken).toHaveLength(43)
    expect(first.profile).toMatchObject({ version: 0, name: 'Shop A' })
    expect(JSON.stringify(w.master.seats)).toBe(before) // no password / code change
    expect(w.master.devices).toHaveLength(1)
    const again = await j(await handleAdopt(post('adopt', ADOPT(), withDevice(first.deviceToken)), w.deps))
    expect(again).toMatchObject({ ok: true, existing: true, deviceToken: null })
    expect(w.master.devices).toHaveLength(1)
    // a device token of ANOTHER seat does not count as "existing"
    w.company.sessions.set('jwt-1', { id: 'user-1', email: 'seat1@shop.invalid' })
    const other = await j(await handleAdopt(post('adopt', ADOPT('jwt-1'), withDevice(first.deviceToken)), w.deps))
    expect(other).toMatchObject({ existing: false, seat: { no: 1 } })
    expect(w.master.devices).toHaveLength(2)
    expect(s2.password).toBeTruthy()
  })

  it('url is compared lower-case without a trailing slash', async () => {
    const { w } = await ready()
    w.company.sessions.set('jwt-ok', { id: 'user-2', email: null })
    const r = await handleAdopt(post('adopt', { ...ADOPT(), supabaseUrl: 'HTTPS://ABCD.supabase.co/' }), w.deps)
    expect(r.status).toBe(200)
  })

  it('a legacy seat found by e-mail gets its auth id and e-mail filled at first adopt', async () => {
    const w = world()
    await seedCompany(w)
    await seedSeat(w, 3, { legacy: true })
    const row = w.master.seats[0]!
    row.auth_user_id = null
    row.email = null
    w.company.sessions.set('jwt-ok', { id: 'user-3', email: 'seat3@shop.invalid' })
    // no auth id and no e-mail on the row: only an e-mail match could find it, so add the e-mail first
    row.email = 'seat3@shop.invalid'
    const r = await j(await handleAdopt(post('adopt', ADOPT()), w.deps))
    expect(r.seat.no).toBe(3)
    expect(row.auth_user_id).toBe('user-3')
    // and a legacy row with an auth id but no e-mail gets the e-mail
    row.email = null
    const r2 = await j(await handleAdopt(post('adopt', ADOPT()), w.deps))
    expect(r2.ok).toBe(true)
    expect(row.email).toBe('seat3@shop.invalid')
  })

  it('bad session -> Q3M14; unregistered company -> Q3M15; revoked seat -> Q3M07; suspended -> Q3M06', async () => {
    const { w } = await ready()
    const bad = await handleAdopt(post('adopt', ADOPT('nope')), w.deps)
    expect(bad.status).toBe(401)
    expect((await j(bad)).code).toBe('Q3M14')
    const unknown = await handleAdopt(post('adopt', { ...ADOPT(), supabaseUrl: 'https://other.supabase.co' }), w.deps)
    expect(unknown.status).toBe(404)
    expect((await j(unknown)).code).toBe('Q3M15')
    w.company.sessions.set('jwt-5', { id: 'user-5', email: null }) // valid session, no seat in the master
    expect((await j(await handleAdopt(post('adopt', ADOPT('jwt-5')), w.deps))).code).toBe('Q3M14')
    await seedSeat(w, 6, { status: 'revoked' })
    w.company.sessions.set('jwt-6', { id: 'user-6', email: 'seat6@shop.invalid' })
    expect((await j(await handleAdopt(post('adopt', ADOPT('jwt-6')), w.deps))).code).toBe('Q3M07')
    w.master.companies[0]!.status = 'suspended'
    expect((await j(await handleAdopt(post('adopt', ADOPT('jwt-ok')), w.deps))).code).toBe('Q3M06')
    expect(w.master.devices).toHaveLength(0)
  })

  it('failed adopts count toward the rate limit; the company being down is Q3M99', async () => {
    const { w } = await ready()
    for (let i = 0; i < 10; i++) await handleAdopt(post('adopt', ADOPT('nope')), w.deps)
    expect((await j(await handleAdopt(post('adopt', ADOPT('nope')), w.deps))).code).toBe('Q3M02')
    const w2 = await ready()
    w2.w.company.down = true
    const r = await handleAdopt(post('adopt', ADOPT()), w2.w.deps)
    expect(r.status).toBe(500)
    expect((await j(r)).code).toBe('Q3M99')
    expect(w2.w.logLines.join('\n')).not.toContain('jwt-ok')
  })
})

describe('T6 refresh', () => {
  it('returns the current credentials of THAT seat only; after a reset the NEW password', async () => {
    const { w, s1, s2 } = await ready()
    const tok = await redeemToken(w, s2.code)
    const r = await j(await handleRefresh(post('refresh', { v: 1 }, withDevice(tok)), w.deps))
    expect(r).toEqual({
      ok: true, supabaseUrl: COMPANY_URL, anonKey: 'company-anon-key-value', license: LICENSE,
      seat: { no: 2, email: 'seat2@shop.invalid', password: s2.password }, legacy: false
    })
    expect(JSON.stringify(r)).not.toContain(s1.password)
    // what Phase 261's reset will do: a new sealed password in the row
    w.master.seats.find((s) => s.seat_no === 2)!.password_enc = await sealText(KEK, 'brand-new-pw', aadSeatPassword(COMPANY_ID, 2))
    const r2 = await j(await handleRefresh(post('refresh', { v: 1 }, withDevice(tok)), w.deps))
    expect(r2.seat.password).toBe('brand-new-pw')
  })

  it('a revoked seat -> Q3M07; a suspended company -> Q3M06; unknown / missing token -> Q3M04', async () => {
    const { w, s2 } = await ready()
    const tok = await redeemToken(w, s2.code)
    expect((await j(await handleRefresh(post('refresh', { v: 1 }), w.deps))).code).toBe('Q3M04')
    expect((await j(await handleRefresh(post('refresh', { v: 1 }, withDevice('x'.repeat(43))), w.deps))).code).toBe('Q3M04')
    w.master.companies[0]!.status = 'suspended'
    expect((await j(await handleRefresh(post('refresh', { v: 1 }, withDevice(tok)), w.deps))).code).toBe('Q3M06')
    w.master.companies[0]!.status = 'active'
    w.master.seats.find((s) => s.seat_no === 2)!.status = 'revoked'
    const r = await handleRefresh(post('refresh', { v: 1 }, withDevice(tok)), w.deps)
    expect(r.status).toBe(403)
    expect((await j(r)).code).toBe('Q3M07')
  })

  it('a legacy seat -> password:null, legacy:true', async () => {
    const w = world()
    await seedCompany(w)
    await seedSeat(w, 4, { legacy: true })
    w.company.sessions.set('jwt-ok', { id: 'user-4', email: 'seat4@shop.invalid' })
    const tok = (await j(await handleAdopt(post('adopt', ADOPT()), w.deps))).deviceToken
    const r = await j(await handleRefresh(post('refresh', { v: 1 }, withDevice(tok)), w.deps))
    expect(r.seat).toEqual({ no: 4, email: 'seat4@shop.invalid', password: null })
    expect(r.legacy).toBe(true)
  })
})

describe('T7 heartbeat', () => {
  it('returns profileVersion, profileChanged, statuses; last_seen_at at most once per 60 s', async () => {
    const { w, s2 } = await ready()
    const tok = await redeemToken(w, s2.code)
    const hb = (pv: number | null) => handleHeartbeat(post('heartbeat', { v: 1, profileVersion: pv, appVersion: '0.1.56' }, withDevice(tok)), w.deps)
    const a = await j(await hb(0))
    expect(a).toMatchObject({
      ok: true, profileVersion: 0, profileChanged: false, seat: { no: 2, label: 'Seat 2', status: 'active' },
      company: { status: 'active' }, serverTime: '2026-11-13T10:00:00.000Z'
    })
    expect(w.master.touches).toBe(1)
    w.clock.t += 30_000
    await hb(0)
    expect(w.master.touches).toBe(1) // inside 60 s
    w.clock.t += 31_000
    await hb(0)
    expect(w.master.touches).toBe(2)
    w.master.companies[0]!.profile_version = 4
    expect((await j(await hb(3))).profileChanged).toBe(true)
    expect((await j(await hb(null))).profileChanged).toBe(true)
    expect((await j(await hb(4))).profileChanged).toBe(false)
  })

  it('a revoked seat or a suspended company is a STATUS, not an error', async () => {
    const { w, s2 } = await ready()
    const tok = await redeemToken(w, s2.code)
    w.master.seats.find((s) => s.seat_no === 2)!.status = 'revoked'
    w.master.companies[0]!.status = 'suspended'
    const r = await handleHeartbeat(post('heartbeat', { v: 1, profileVersion: null, appVersion: '1' }, withDevice(tok)), w.deps)
    expect(r.status).toBe(200)
    expect(await j(r)).toMatchObject({ ok: true, seat: { status: 'revoked' }, company: { status: 'suspended' } })
    expect((await j(await handleHeartbeat(post('heartbeat', { v: 1, profileVersion: null, appVersion: '1' }), w.deps))).code).toBe('Q3M04')
  })
})

describe('T8 profile-get', () => {
  it('returns the profile; never set -> version 0 and the label as name; a bad token -> Q3M04', async () => {
    const { w, s2 } = await ready()
    const tok = await redeemToken(w, s2.code)
    const get = (headers: Record<string, string>) => handleProfileGet(post('profile-get', { v: 1 }, headers), w.deps)
    expect((await j(await get(withDevice(tok)))).profile).toEqual({ version: 0, name: 'Shop A', phone: '', address: '', logo: null })
    w.master.companies[0]!.profile = { name: 'Shop A Traders', phone: '99', address: 'Road 5', logo: 'iVBORw0KGgo=' }
    w.master.companies[0]!.profile_version = 2
    expect((await j(await get(withDevice(tok)))).profile).toEqual({
      version: 2, name: 'Shop A Traders', phone: '99', address: 'Road 5', logo: 'iVBORw0KGgo='
    })
    const bad = await get(withDevice('nope'))
    expect(bad.status).toBe(401)
    expect((await j(bad)).code).toBe('Q3M04')
    w.master.seats.find((s) => s.seat_no === 2)!.status = 'revoked'
    expect((await j(await get(withDevice(tok)))).code).toBe('Q3M07')
  })
})

describe('C1 wire conventions', () => {
  it('OPTIONS -> 204 with CORS; POST responses carry the allowed origin; only POST is accepted', async () => {
    const { w } = await ready()
    const pre = await handleRedeem(new Request('https://m.invalid/functions/v1/redeem', { method: 'OPTIONS' }), w.deps)
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(pre.headers.get('access-control-allow-headers')).toBe('apikey, authorization, content-type, x-q3-device')
    const ok = await handleRedeem(post('redeem', { ...REDEEM, code: 'nonsense' }), w.deps)
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(ok.headers.get('content-type')).toContain('application/json')
    const get = await handleRedeem(new Request('https://m.invalid/functions/v1/redeem'), w.deps)
    expect(get.status).toBe(400)
    expect((await j(get)).code).toBe('Q3M03')
  })

  it('bad JSON -> Q3M03; a body over 400 KB -> Q3M18; no origin configured -> no CORS origin header', async () => {
    const { w } = await ready()
    const bad = await handleRedeem(new Request('https://m.invalid/x', { method: 'POST', body: '{nope' }), w.deps)
    expect((await j(bad)).code).toBe('Q3M03')
    const big = await handleRedeem(post('redeem', { ...REDEEM, code: 'x'.repeat(410 * 1024) }), w.deps)
    expect(big.status).toBe(413)
    expect((await j(big)).code).toBe('Q3M18')
    w.deps.allowedOrigin = ''
    expect((await handleRedeem(post('redeem', {}), w.deps)).headers.get('access-control-allow-origin')).toBeNull()
  })

  it('an internal failure answers Q3M99 and nothing secret reaches the log', async () => {
    const { w, s2 } = await ready()
    w.deps.db.insertDevice = async () => { throw new Error(`boom password=${s2.password} code ${s2.code}`) }
    const r = await handleRedeem(post('redeem', { ...REDEEM, code: s2.code }), w.deps)
    expect(r.status).toBe(500)
    expect((await j(r)).code).toBe('Q3M99')
    const logged = w.logLines.join('\n') + JSON.stringify(w.master.logs)
    expect(logged).not.toContain(s2.password)
    expect(logged).not.toContain(s2.code)
    expect(logged).toContain('internal')
  })

  it('master_log holds only ok / error codes, never a secret', async () => {
    const { w, s2 } = await ready()
    await handleRedeem(post('redeem', { ...REDEEM, code: s2.code }), w.deps)
    await handleRedeem(post('redeem', { ...REDEEM, code: 'nonsense' }), w.deps)
    expect(w.master.logs.map((l) => l.detail)).toEqual(['ok', 'Q3M01'])
    expect(JSON.stringify(w.master.logs)).not.toContain(s2.password)
  })
})
