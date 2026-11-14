/** Phase 261 - the seat-admin Edge Functions (F6-F13) against the in-memory fake master + fake company: test cases T9..T20 of M24-0 C7. */
import { describe, expect, it } from 'vitest'
import { handleEnrol } from '../../../supabase/master/functions/enrol/handler'
import { handleProfileSet } from '../../../supabase/master/functions/profile-set/handler'
import { handleRedeem } from '../../../supabase/master/functions/redeem/handler'
import { handleRefresh } from '../../../supabase/master/functions/refresh/handler'
import { handleSeatCreate } from '../../../supabase/master/functions/seat-create/handler'
import { handleSeatList } from '../../../supabase/master/functions/seat-list/handler'
import { handleSeatRegen } from '../../../supabase/master/functions/seat-regen/handler'
import { handleSeatRename } from '../../../supabase/master/functions/seat-rename/handler'
import { handleSeatReset } from '../../../supabase/master/functions/seat-reset/handler'
import { handleSeatRevoke } from '../../../supabase/master/functions/seat-revoke/handler'
import { aadSeatPassword } from '../../../supabase/master/functions/_shared/aad'
import { redactedJson } from '../../shared/master/redact'
import { looksSealed, openText, sha256Hex } from '../../shared/master/seal'
import { COMPANY_ID, COMPANY_URL, KEK, LICENSE, post, seedCompany, seedSeat, world, type World } from './fakes'

const ADMIN_TOKEN = 'A'.repeat(43)
const OTHER_TOKEN = 'B'.repeat(43)
const rid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let reqCounter = 100
const fresh = (): string => rid(++reqCounter)

interface Admin extends World { adminCode: string }

/** A company with seat 1 (admin device) and seats 2 + 3 (seat 3 is a device of a normal seat). */
async function setup(opts: { seats?: number; legacy2?: boolean } = {}): Promise<Admin> {
  const w = world()
  await seedCompany(w)
  const n = opts.seats ?? 3
  for (let i = 1; i <= n; i++) {
    await seedSeat(w, i, { legacy: i === 2 && opts.legacy2 === true })
    w.company.members.push({ seat_no: i, user_id: `user-${i}` })
  }
  await w.master.insertDevice({ company_id: COMPANY_ID, seat_no: 1, token_hash: await sha256Hex(ADMIN_TOKEN), label: 'office', platform: 'desktop', app_version: '0.1.56' })
  await w.master.insertDevice({ company_id: COMPANY_ID, seat_no: Math.min(3, n), token_hash: await sha256Hex(OTHER_TOKEN), label: 'phone', platform: 'phone', app_version: '0.1.56' })
  return Object.assign(w, { adminCode: '' })
}

const admin = (token = ADMIN_TOKEN): Record<string, string> => ({ 'x-q3-device': token })
async function run(h: (r: Request, d: World['deps']) => Promise<Response>, w: World, fn: string, body: Record<string, unknown>, token = ADMIN_TOKEN) {
  const res = await h(post(fn, { v: 1, ...body }, admin(token)), w.deps)
  return { status: res.status, body: (await res.json()) as Record<string, any> }
}
const create = (w: World, label = 'Counter', req = fresh(), token = ADMIN_TOKEN) => run(handleSeatCreate, w, 'seat-create', { reqId: req, label }, token)
const json = async (r: Response): Promise<Record<string, any>> => (await r.json()) as Record<string, any>
const rpcCount = (w: World, fn: string): number => w.company.rpcLog.filter((c) => c.fn === fn).length

describe('T9 only seat 1 may call an admin function', () => {
  it('every admin function answers Q3M05 for another seat', async () => {
    const w = await setup()
    const cases: Array<[typeof handleSeatCreate, string, Record<string, unknown>]> = [
      [handleSeatCreate, 'seat-create', { reqId: fresh(), label: 'X' }],
      [handleSeatList, 'seat-list', {}],
      [handleSeatReset, 'seat-reset', { reqId: fresh(), seatNo: 2 }],
      [handleSeatRevoke, 'seat-revoke', { reqId: fresh(), seatNo: 2 }],
      [handleSeatRename, 'seat-rename', { seatNo: 2, label: 'Y' }],
      [handleSeatRegen, 'seat-regen', { reqId: fresh(), seatNo: 2 }],
      [handleProfileSet, 'profile-set', { reqId: fresh(), name: 'N', phone: '', address: '' }]
    ]
    for (const [h, fn, body] of cases) {
      const r = await run(h, w, fn, body, OTHER_TOKEN)
      expect(r.status, fn).toBe(403)
      expect(r.body.code, fn).toBe('Q3M05')
    }
    expect(w.company.rpcLog).toHaveLength(0)
    expect(w.master.seats).toHaveLength(3)
  })
  it('no token or an unknown token -> Q3M04', async () => {
    const w = await setup()
    expect((await w.deps && (await handleSeatList(post('seat-list', { v: 1 }), w.deps)).status)).toBe(401)
    expect((await run(handleSeatList, w, 'seat-list', {}, 'Z'.repeat(43))).body.code).toBe('Q3M04')
  })
})

describe('seat-list (F7)', () => {
  it('lists every seat with its code, ordered, devices counted, never a password', async () => {
    const w = await setup({ legacy2: true })
    const r = await run(handleSeatList, w, 'seat-list', {})
    expect(r.status).toBe(200)
    expect(r.body.company).toEqual({ id: COMPANY_ID, label: 'Shop A', maxSeats: 15, status: 'active' })
    expect(r.body.seats.map((s: any) => s.no)).toEqual([1, 2, 3])
    expect(r.body.seats[0].code).toMatch(/^Q3C-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/)
    expect(r.body.seats[1]).toMatchObject({ legacy: true, code: null })
    expect(r.body.seats[0].devices).toBe(1)
    expect(JSON.stringify(r.body)).not.toMatch(/pw-seat|password/)
  })
})

describe('T10 / T11 seat-create', () => {
  it('T11 ok: one qt_add_seats call with the label and n=1, sealed password, code but no password in the answer', async () => {
    const w = await setup()
    const r = await create(w, 'Counter 4')
    expect(r.status).toBe(200)
    expect(rpcCount(w, 'qt_add_seats')).toBe(1)
    expect(w.company.rpcLog.find((c) => c.fn === 'qt_add_seats')!.args).toEqual({ p_label: 'Shop A', p_n: 1 })
    expect(w.company.rpcLog.find((c) => c.fn === 'qt_add_seats')!.key).toBe('service-role-key-secret') // the unsealed key reached the company only
    const row = w.master.seats.find((s) => s.seat_no === 4)!
    expect(row).toMatchObject({ label: 'Counter 4', status: 'active', legacy: false })
    expect(looksSealed(row.password_enc!)).toBe(true)
    expect(row.password_enc).not.toContain('fresh-pw')
    expect(await openText(KEK, row.password_enc!, aadSeatPassword(COMPANY_ID, 4))).toBe('fresh-pw-1')
    expect(r.body.seat.no).toBe(4)
    expect(r.body.seat.code).toMatch(/^Q3C-/)
    expect(JSON.stringify(r.body)).not.toContain('fresh-pw')
    expect(row.code_hash).toHaveLength(64)
  })
  it('T10 15 active seats -> Q3M08 and the company is not called', async () => {
    const w = await setup({ seats: 15 })
    const r = await create(w)
    expect(r.body.code).toBe('Q3M08')
    expect(rpcCount(w, 'qt_add_seats')).toBe(0)
    expect(w.master.seats).toHaveLength(15)
  })
  it('a revoked seat does not count: with 14 active + 1 revoked the 16th number is undone', async () => {
    const w = await setup({ seats: 15 })
    await w.master.updateSeat(COMPANY_ID, 15, { status: 'revoked', code_hash: null, code_enc: null, code_hint: null })
    w.company.forceSeatNo = 16 // the company numbers it max+1 = 16
    const r = await create(w)
    expect(r.body.code).toBe('Q3M08')
    expect(rpcCount(w, 'qt_add_seats')).toBe(1)
    expect(rpcCount(w, 'qt_revoke_seat')).toBe(1) // undone
    expect(w.company.rpcLog.find((c) => c.fn === 'qt_revoke_seat')!.args).toEqual({ p_label: 'Shop A', p_seat_no: 16 })
    expect(w.master.seats.some((s) => s.seat_no === 16)).toBe(false)
  })
  it('a returned number that equals a revoked master row replaces it and drops its old devices', async () => {
    const w = await setup()
    await w.master.updateSeat(COMPANY_ID, 3, { status: 'revoked', code_hash: null, code_enc: null, code_hint: null, password_enc: null })
    w.company.members = w.company.members.filter((m) => m.seat_no !== 3)
    const r = await create(w, 'New three')
    expect(r.body.seat.no).toBe(3)
    expect(w.master.seats.filter((s) => s.seat_no === 3)).toHaveLength(1)
    expect(w.master.seats.find((s) => s.seat_no === 3)).toMatchObject({ status: 'active', label: 'New three' })
    expect(w.master.devices.some((d) => d.seat_no === 3)).toBe(false) // the old phone does not inherit the new seat
  })
  it('bad label -> Q3M03; label trimmed', async () => {
    const w = await setup()
    expect((await create(w, '')).body.code).toBe('Q3M03')
    expect((await create(w, 'x'.repeat(41))).body.code).toBe('Q3M03')
    expect((await create(w, '  Till  ')).body.seat.label).toBe('Till')
  })
})

describe('T12 seat 1 is protected', () => {
  it('reset and revoke of seat 1 -> Q3M10 with no company call', async () => {
    const w = await setup()
    expect((await run(handleSeatReset, w, 'seat-reset', { reqId: fresh(), seatNo: 1 })).body.code).toBe('Q3M10')
    expect((await run(handleSeatRevoke, w, 'seat-revoke', { reqId: fresh(), seatNo: 1 })).body.code).toBe('Q3M10')
    expect(w.company.rpcLog).toHaveLength(0)
  })
})

describe('T13 seat-reset', () => {
  it('new password sealed, legacy -> false, old code dead, new code works, the seat device gets the new password', async () => {
    const w = await setup({ legacy2: true })
    // seat 3 is a normal seat with a code: reset it
    const oldCode = (await run(handleSeatList, w, 'seat-list', {})).body.seats[2].code as string
    const dev = OTHER_TOKEN
    expect((await handleRefresh(post('refresh', { v: 1 }, admin(dev)), w.deps).then(json)).seat.password).toBe('pw-seat-3-secret')
    const r = await run(handleSeatReset, w, 'seat-reset', { reqId: fresh(), seatNo: 3 })
    expect(r.status).toBe(200)
    expect(rpcCount(w, 'qt_reset_seat')).toBe(1)
    expect(r.body.seat.code).toMatch(/^Q3C-/)
    expect(r.body.seat.code).not.toBe(oldCode)
    expect(r.body.seat.resetAt).toBeTruthy()
    expect(JSON.stringify(r.body)).not.toContain('fresh-pw')
    const row = w.master.seats.find((s) => s.seat_no === 3)!
    expect(await openText(KEK, row.password_enc!, aadSeatPassword(COMPANY_ID, 3))).toBe('fresh-pw-1')
    // old code -> Q3M01, new code works
    const old = await handleRedeem(post('redeem', { v: 1, code: oldCode, platform: 'phone', appVersion: '0.1.56' }), w.deps)
    expect((await json(old)).code).toBe('Q3M01')
    const neu = await handleRedeem(post('redeem', { v: 1, code: r.body.seat.code, platform: 'phone', appVersion: '0.1.56' }, {}, '198.51.100.9'), w.deps)
    expect((await json(neu)).bundle.seat.password).toBe('fresh-pw-1')
    // the linked device of that seat now gets the new password
    expect((await handleRefresh(post('refresh', { v: 1 }, admin(dev)), w.deps).then(json)).seat.password).toBe('fresh-pw-1')
  })
  it('the first reset of a legacy seat makes it non-legacy and gives it a code', async () => {
    const w = await setup({ legacy2: true })
    const r = await run(handleSeatReset, w, 'seat-reset', { reqId: fresh(), seatNo: 2 })
    expect(r.body.seat).toMatchObject({ legacy: false })
    expect(r.body.seat.code).toMatch(/^Q3C-/)
    const row = w.master.seats.find((s) => s.seat_no === 2)!
    expect(row.legacy).toBe(false)
    expect(row.password_enc).not.toBeNull()
  })
  it('unknown seat -> Q3M09, revoked seat -> Q3M07', async () => {
    const w = await setup()
    expect((await run(handleSeatReset, w, 'seat-reset', { reqId: fresh(), seatNo: 9 })).body.code).toBe('Q3M09')
    await run(handleSeatRevoke, w, 'seat-revoke', { reqId: fresh(), seatNo: 2 })
    expect((await run(handleSeatReset, w, 'seat-reset', { reqId: fresh(), seatNo: 2 })).body.code).toBe('Q3M07')
  })
})

describe('T14 seat-revoke', () => {
  it('qt_revoke_seat called, code gone, the seat devices get Q3M07 on refresh, revoking again is ok', async () => {
    const w = await setup()
    const code3 = (await run(handleSeatList, w, 'seat-list', {})).body.seats[2].code as string
    const r = await run(handleSeatRevoke, w, 'seat-revoke', { reqId: fresh(), seatNo: 3 })
    expect(r.status).toBe(200)
    expect(rpcCount(w, 'qt_revoke_seat')).toBe(1)
    expect(r.body.seat).toMatchObject({ status: 'revoked', code: null, codeHint: null })
    const row = w.master.seats.find((s) => s.seat_no === 3)!
    expect(row).toMatchObject({ code_hash: null, code_enc: null, password_enc: null })
    expect((await handleRefresh(post('refresh', { v: 1 }, admin(OTHER_TOKEN)), w.deps).then(json)).code).toBe('Q3M07')
    const redeem = await handleRedeem(post('redeem', { v: 1, code: code3, platform: 'phone', appVersion: '0.1.56' }), w.deps)
    expect((await json(redeem)).code).toBe('Q3M01')
    const again = await run(handleSeatRevoke, w, 'seat-revoke', { reqId: fresh(), seatNo: 3 })
    expect(again.status).toBe(200)
    expect(rpcCount(w, 'qt_revoke_seat')).toBe(1) // not called a second time
    expect(w.master.devices.some((d) => d.seat_no === 3)).toBe(true) // devices kept so they can say "removed"
  })
  it('unknown seat -> Q3M09', async () => {
    const w = await setup()
    expect((await run(handleSeatRevoke, w, 'seat-revoke', { reqId: fresh(), seatNo: 12 })).body.code).toBe('Q3M09')
  })
})

describe('T15 seat-rename', () => {
  it('ok (master only, seat 1 too); empty or 41 characters -> Q3M03', async () => {
    const w = await setup()
    const r = await run(handleSeatRename, w, 'seat-rename', { seatNo: 2, label: ' Back office ' })
    expect(r.body.seat).toMatchObject({ no: 2, label: 'Back office' })
    expect(w.company.rpcLog).toHaveLength(0)
    expect((await run(handleSeatRename, w, 'seat-rename', { seatNo: 1, label: 'Owner' })).body.seat.label).toBe('Owner')
    expect((await run(handleSeatRename, w, 'seat-rename', { seatNo: 2, label: '' })).body.code).toBe('Q3M03')
    expect((await run(handleSeatRename, w, 'seat-rename', { seatNo: 2, label: 'x'.repeat(41) })).body.code).toBe('Q3M03')
    expect((await run(handleSeatRename, w, 'seat-rename', { seatNo: 9, label: 'Z' })).body.code).toBe('Q3M09')
  })
})

describe('T16 seat-regen', () => {
  it('old code -> Q3M01, new code works, linked devices keep working; a legacy seat -> Q3M21', async () => {
    const w = await setup({ legacy2: true })
    const oldCode = (await run(handleSeatList, w, 'seat-list', {})).body.seats[2].code as string
    const before = w.master.seats.find((s) => s.seat_no === 3)!.password_enc
    const r = await run(handleSeatRegen, w, 'seat-regen', { reqId: fresh(), seatNo: 3 })
    expect(r.status).toBe(200)
    expect(r.body.seat.code).not.toBe(oldCode)
    expect(w.master.seats.find((s) => s.seat_no === 3)!.password_enc).toBe(before) // password untouched
    expect(w.company.rpcLog).toHaveLength(0)
    expect((await json(await handleRedeem(post('redeem', { v: 1, code: oldCode, platform: 'phone', appVersion: '0.1.56' }), w.deps))).code).toBe('Q3M01')
    const ok = await json(await handleRedeem(post('redeem', { v: 1, code: r.body.seat.code, platform: 'phone', appVersion: '0.1.56' }, {}, '198.51.100.8'), w.deps))
    expect(ok.bundle.seat.no).toBe(3)
    expect((await handleRefresh(post('refresh', { v: 1 }, admin(OTHER_TOKEN)), w.deps)).status).toBe(200)
    expect((await run(handleSeatRegen, w, 'seat-regen', { reqId: fresh(), seatNo: 2 })).body.code).toBe('Q3M21')
    expect((await run(handleSeatRegen, w, 'seat-regen', { reqId: fresh(), seatNo: 8 })).body.code).toBe('Q3M09')
  })
})

describe('T17 profile-set', () => {
  const set = (w: World, over: Record<string, unknown> = {}) => run(handleProfileSet, w, 'profile-set', { reqId: fresh(), name: 'Shop A Ltd', phone: '555', address: '1 Road', ...over })
  it('bumps the version by exactly 1 when something changed and by 0 when nothing changed', async () => {
    const w = await setup()
    const a = await set(w)
    expect(a.body.profile).toMatchObject({ version: 1, name: 'Shop A Ltd', phone: '555', address: '1 Road', logo: null })
    const same = await set(w)
    expect(same.body.profile.version).toBe(1)
    const b = await set(w, { phone: '556' })
    expect(b.body.profile.version).toBe(2)
    expect(w.master.companies[0]!.profile_version).toBe(2)
  })
  it('logo: set, omitted = unchanged, null = removed', async () => {
    const w = await setup()
    const logo = Buffer.from('png-bytes').toString('base64')
    expect((await set(w, { logo })).body.profile).toMatchObject({ version: 1, logo })
    expect((await set(w, { phone: '777' })).body.profile).toMatchObject({ version: 2, logo })
    expect((await set(w, { phone: '777', logo: null })).body.profile).toMatchObject({ version: 3, logo: null })
  })
  it('a logo over 150 KB or a text over 200 chars -> Q3M18, nothing changes', async () => {
    const w = await setup()
    const big = Buffer.alloc(150 * 1024 + 10, 1).toString('base64')
    expect((await set(w, { logo: big })).body.code).toBe('Q3M18')
    expect((await set(w, { name: 'n'.repeat(201) })).body.code).toBe('Q3M18')
    expect((await set(w, { logo: 'not base64 !!' })).body.code).toBe('Q3M18')
    expect(w.master.companies[0]!.profile_version).toBe(0)
  })
  it('a wrong expectVersion -> Q3M20; the right one passes', async () => {
    const w = await setup()
    expect((await set(w, { expectVersion: 4 })).body.code).toBe('Q3M20')
    expect((await set(w, { expectVersion: 0 })).body.profile.version).toBe(1)
    expect((await set(w, { expectVersion: 0, phone: '1' })).body.code).toBe('Q3M20')
  })
})

describe('T18 a repeated reqId changes nothing', () => {
  it('seat-create, reset, revoke, regen and profile-set answer Q3M13 the second time', async () => {
    const w = await setup()
    const q = fresh()
    expect((await create(w, 'A', q)).status).toBe(200)
    const dup = await create(w, 'A', q)
    expect(dup.body.code).toBe('Q3M13')
    expect(rpcCount(w, 'qt_add_seats')).toBe(1)
    expect(w.master.seats).toHaveLength(4)

    for (const [h, fn, body] of [
      [handleSeatReset, 'seat-reset', { seatNo: 2 }], [handleSeatRegen, 'seat-regen', { seatNo: 3 }],
      [handleSeatRevoke, 'seat-revoke', { seatNo: 4 }], [handleProfileSet, 'profile-set', { name: 'N', phone: '', address: '' }]
    ] as const) {
      const id = fresh()
      expect((await run(h as typeof handleSeatReset, w, fn, { reqId: id, ...body })).status, fn).toBe(200)
      const second = await run(h as typeof handleSeatReset, w, fn, { reqId: id, ...body })
      expect(second.body.code, fn).toBe('Q3M13')
    }
    expect(rpcCount(w, 'qt_reset_seat')).toBe(1)
    expect(rpcCount(w, 'qt_revoke_seat')).toBe(1)
  })
  it('after a company outage the same reqId may be retried (the claim was given back)', async () => {
    const w = await setup()
    const q = fresh()
    w.company.failRpc = 'unreachable'
    expect((await create(w, 'A', q)).body.code).toBe('Q3M11')
    w.company.failRpc = null
    expect((await create(w, 'A', q)).status).toBe(200)
  })
})

describe('T20 suspended company, company failures, master rows unchanged', () => {
  it('a suspended company on any admin call -> Q3M06', async () => {
    const w = await setup()
    w.master.companies[0]!.status = 'suspended'
    for (const [h, fn, body] of [
      [handleSeatList, 'seat-list', {}], [handleSeatCreate, 'seat-create', { reqId: fresh(), label: 'A' }],
      [handleSeatRename, 'seat-rename', { seatNo: 2, label: 'B' }], [handleProfileSet, 'profile-set', { reqId: fresh(), name: 'N', phone: '', address: '' }]
    ] as const) {
      expect((await run(h as typeof handleSeatList, w, fn, body)).body.code, fn).toBe('Q3M06')
    }
    expect(w.company.rpcLog).toHaveLength(0)
  })
  it('an unreachable company -> Q3M11, a refusing one -> Q3M12, master rows unchanged', async () => {
    const w = await setup()
    const snapshot = JSON.stringify(w.master.seats)
    w.company.failRpc = 'unreachable'
    expect((await create(w)).body.code).toBe('Q3M11')
    expect((await run(handleSeatReset, w, 'seat-reset', { reqId: fresh(), seatNo: 2 })).body.code).toBe('Q3M11')
    expect((await run(handleSeatRevoke, w, 'seat-revoke', { reqId: fresh(), seatNo: 2 })).body.code).toBe('Q3M11')
    w.company.failRpc = 'refused'
    expect((await create(w)).body.code).toBe('Q3M12')
    expect((await run(handleSeatReset, w, 'seat-reset', { reqId: fresh(), seatNo: 2 })).body.code).toBe('Q3M12')
    expect(JSON.stringify(w.master.seats)).toBe(snapshot)
  })
  it('the company worked but the master write failed -> Q3M99, logged for the owner, nothing secret in any log', async () => {
    const w = await setup()
    w.master.failMasterWrite = true
    const r = await create(w)
    expect(r.body.code).toBe('Q3M99')
    expect(w.master.logs.some((l) => l.action === 'seat-create.master_write_failed' && l.detail === 'Q3M99')).toBe(true)
    const everything = redactedJson(w.master.logs) + w.logLines.join('\n') + JSON.stringify(w.master.logs)
    expect(everything).not.toContain('fresh-pw')
    expect(everything).not.toContain('service-role-key-secret')
    for (const l of w.master.logs) expect(l.detail).toMatch(/^(ok|Q3M\d\d)$/)
  })
  it('a wrong or unsealable service_role key is a company refusal / internal error, never a leak', async () => {
    const w = await setup()
    w.company.serviceKey = 'another-key'
    const r = await create(w)
    expect(r.body.code).toBe('Q3M12')
    expect(JSON.stringify(r.body)).not.toContain('service-role-key-secret')
  })
})

describe('T19 / T20 enrol', () => {
  const TOKEN = 'owner-enrol-token-123'
  async function enrolWorld(opts: { users?: number; token?: Partial<{ used_at: string | null; expires_at: string; company_label: string }> } = {}) {
    const w = world()
    w.company.members = Array.from({ length: opts.users ?? 3 }, (_, i) => ({ seat_no: i + 1, user_id: `user-${i + 1}` }))
    w.company.sessions.set('seat1-access', { id: 'user-1', email: 'shop-a-1@quot3.example.com' })
    w.company.sessions.set('seat2-access', { id: 'user-2', email: 'shop-a-2@quot3.example.com' })
    w.master.enrolTokens.push({ token_hash: await sha256Hex(TOKEN), company_label: 'Shop A', expires_at: '2026-11-14T10:00:00Z', used_at: null, ...opts.token })
    return w
  }
  const body = (over: Record<string, unknown> = {}) => ({
    v: 1, enrolToken: TOKEN, label: 'Shop A', supabaseUrl: 'https://ABCD.supabase.co/', anonKey: 'company-anon-key-value', license: LICENSE,
    accessToken: 'seat1-access', serviceRoleKey: 'service-role-key-secret', platform: 'desktop', appVersion: '0.1.56', ...over
  })
  const enrol = (w: World, over: Record<string, unknown> = {}, ip = '203.0.113.7') => handleEnrol(post('enrol', body(over), {}, ip), w.deps).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, any> }))

  it('T19 ok: company registered, every sn_members row recorded legacy, sealed secrets, token used', async () => {
    const w = await enrolWorld()
    const r = await enrol(w)
    expect(r.status).toBe(200)
    expect(r.body.deviceToken).toHaveLength(43)
    expect(r.body.seats).toBe(3)
    expect(r.body.company.label).toBe('Shop A')
    expect(r.body.profile).toMatchObject({ version: 0, name: 'Shop A', logo: null })
    const c = w.master.companies[0]!
    expect(c).toMatchObject({ label: 'Shop A', org_id: w.company.orgId, supabase_url: 'https://abcd.supabase.co', status: 'active', max_seats: 15 })
    expect(looksSealed(c.service_role_enc) && looksSealed(c.license_key_enc)).toBe(true)
    expect(c.service_role_enc).not.toContain('service-role-key-secret')
    expect(JSON.stringify(w.master.companies)).not.toContain('service-role-key-secret')
    expect(JSON.stringify(w.master.companies)).not.toContain(LICENSE)
    expect(w.master.seats.map((s) => [s.seat_no, s.legacy, s.status, s.label])).toEqual([[1, true, 'active', 'Seat 1'], [2, true, 'active', 'Seat 2'], [3, true, 'active', 'Seat 3']])
    expect(w.master.seats.every((s) => s.password_enc === null && s.code_hash === null && s.auth_user_id)).toBe(true)
    expect(w.master.seats[0]!.email).toBe('shop-a-1@quot3.example.com')
    expect(w.master.devices).toHaveLength(1)
    expect(w.master.devices[0]).toMatchObject({ seat_no: 1, platform: 'desktop', token_hash: await sha256Hex(r.body.deviceToken) })
    expect(w.master.enrolTokens[0]!.used_at).not.toBeNull()
    expect(w.logLines.join('')).not.toContain('service-role-key-secret')
  })
  it('the second use of the token -> Q3M16; the same label again -> Q3M17', async () => {
    const w = await enrolWorld()
    expect((await enrol(w)).status).toBe(200)
    expect((await enrol(w)).body.code).toBe('Q3M16')
    w.master.enrolTokens.push({ token_hash: await sha256Hex('second-token'), company_label: 'Shop A', expires_at: '2026-11-14T10:00:00Z', used_at: null })
    expect((await enrol(w, { enrolToken: 'second-token' })).body.code).toBe('Q3M17')
    expect(w.master.companies).toHaveLength(1)
  })
  it('wrong, expired or other-label token -> Q3M16 and nothing is registered', async () => {
    const wrong = await enrolWorld()
    expect((await enrol(wrong, { enrolToken: 'wrong-token' })).body.code).toBe('Q3M16')
    const expired = await enrolWorld({ token: { expires_at: '2026-11-13T09:59:59Z' } })
    expect((await enrol(expired)).body.code).toBe('Q3M16')
    const other = await enrolWorld({ token: { company_label: 'Other' } })
    expect((await enrol(other)).body.code).toBe('Q3M16')
    for (const w of [wrong, expired, other]) expect(w.master.companies).toHaveLength(0)
  })
  it('T20 a session that is not seat 1 -> Q3M05; a bad session -> Q3M14; nothing registered, token stays unused', async () => {
    const w = await enrolWorld()
    expect((await enrol(w, { accessToken: 'seat2-access' })).body.code).toBe('Q3M05')
    expect((await enrol(w, { accessToken: 'nope' })).body.code).toBe('Q3M14')
    expect(w.master.companies).toHaveLength(0)
    expect(w.master.enrolTokens[0]!.used_at).toBeNull()
  })
  it('T20 a company that fails -> Q3M11 / Q3M12 and the master rows are unchanged', async () => {
    const w = await enrolWorld()
    w.company.failRpc = 'unreachable'
    expect((await enrol(w)).body.code).toBe('Q3M11')
    w.company.failRpc = 'refused'
    expect((await enrol(w)).body.code).toBe('Q3M12')
    expect((await enrol(w, { serviceRoleKey: 'wrong-service-key' })).body.code).toBe('Q3M12')
    w.company.failRpc = null
    w.company.down = true
    expect((await enrol(w)).body.code).toBe('Q3M11')
    expect(w.master.companies).toHaveLength(0)
    expect(w.master.seats).toHaveLength(0)
    expect(w.master.enrolTokens[0]!.used_at).toBeNull()
  })
  it('more than 15 existing seats cannot be recorded -> Q3M08', async () => {
    const w = await enrolWorld({ users: 16 })
    expect((await enrol(w)).body.code).toBe('Q3M08')
    expect(w.master.companies).toHaveLength(0)
  })
  it('rate limit: the 11th failed try from one ip -> Q3M02', async () => {
    const w = await enrolWorld()
    for (let i = 0; i < 10; i++) expect((await enrol(w, { enrolToken: `bad-${i}` })).body.code).toBe('Q3M16')
    expect((await enrol(w)).body.code).toBe('Q3M02')
  })
  it('a freshly enrolled company can then be administered by its seat 1 device (list shows the legacy seats)', async () => {
    const w = await enrolWorld()
    const r = await enrol(w)
    const list = await run(handleSeatList, w, 'seat-list', {}, r.body.deviceToken)
    expect(list.status).toBe(200)
    expect(list.body.seats.map((s: any) => [s.no, s.legacy, s.code])).toEqual([[1, true, null], [2, true, null], [3, true, null]])
    const reset = await run(handleSeatReset, w, 'seat-reset', { reqId: fresh(), seatNo: 2 }, r.body.deviceToken)
    expect(reset.status).toBe(200)
    expect(reset.body.seat.legacy).toBe(false)
    expect(COMPANY_URL).toBeTruthy()
  })
})
