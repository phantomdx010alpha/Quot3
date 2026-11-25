/** Phase 280 - F14 payments-get / F15 payments-set against the in-memory fake master + fake company (M25-10 T11-T22). Invented data only. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { handlePaymentsGet } from '../../../supabase/master/functions/payments-get/handler'
import { handlePaymentsSet } from '../../../supabase/master/functions/payments-set/handler'
import { MASTER_FUNCTIONS, PaymentsGetRequestSchema, PaymentsSetRequestSchema, PaymentsGetResponseSchema } from '../../shared/master/schemas'
import { seedList } from '../../shared/payments/seed'
import { sha256Hex } from '../../shared/master/seal'
import { COMPANY_ID, post, seedCompany, seedSeat, world, type World } from './fakes'

const T1 = 'A'.repeat(43) // seat 1
const T2 = 'B'.repeat(43) // seat 2
let ctr = 500
const fresh = (): string => `00000000-0000-4000-8000-${String(++ctr).padStart(12, '0')}`
const body = (): Record<string, unknown> => { const { version: _v, ...b } = seedList(); return b }

async function setup(over: { m05?: boolean } = {}): Promise<World> {
  const w = world()
  const c = await seedCompany(w)
  if (over.m05 !== false) { c.payments = {}; c.payments_version = 0 }
  for (const n of [1, 2]) await seedSeat(w, n)
  w.company.seatRights = null // company SQL 23 not run, until a test says otherwise
  await w.master.insertDevice({ company_id: COMPANY_ID, seat_no: 1, token_hash: await sha256Hex(T1), label: 'office', platform: 'desktop', app_version: '0.1.62' })
  await w.master.insertDevice({ company_id: COMPANY_ID, seat_no: 2, token_hash: await sha256Hex(T2), label: 'phone', platform: 'phone', app_version: '0.1.62' })
  return w
}
async function get(w: World, extra: Record<string, unknown> = {}, token = T1) {
  const res = await handlePaymentsGet(post('payments-get', { v: 1, ...extra }, { 'x-q3-device': token }), w.deps)
  return { status: res.status, body: (await res.json()) as Record<string, any> }
}
async function set(w: World, over: Record<string, unknown> = {}, token = T1) {
  const res = await handlePaymentsSet(post('payments-set', { v: 1, reqId: fresh(), expectVersion: 0, list: body(), ...over }, { 'x-q3-device': token }), w.deps)
  return { status: res.status, body: (await res.json()) as Record<string, any> }
}
const stored = (w: World) => w.master.companies[0]!

describe('registry and schemas', () => {
  it('F14 and F15 are registered after F13 and parse', () => {
    expect(MASTER_FUNCTIONS['payments-get'].n).toBe(14)
    expect(MASTER_FUNCTIONS['payments-set'].n).toBe(15)
    expect(PaymentsGetRequestSchema.safeParse({ v: 1, knownVersion: 2 }).success).toBe(true)
    expect(PaymentsGetRequestSchema.safeParse({ v: 1, knownVersion: -1 }).success).toBe(false)
    expect(PaymentsSetRequestSchema.safeParse({ v: 1, reqId: fresh(), expectVersion: 0, list: body() }).success).toBe(true)
    expect(PaymentsSetRequestSchema.safeParse({ v: 1, reqId: 'x', expectVersion: 0, list: body() }).success).toBe(false)
    expect(PaymentsGetResponseSchema.safeParse({ ok: true, payments: { version: 1, unchanged: false, list: body() } }).success).toBe(true)
  })
})

describe('T11-T13 get and set', () => {
  it('T11 never set -> version 0, list null', async () => {
    const w = await setup()
    const r = await get(w)
    expect(r.status).toBe(200)
    expect(r.body.payments).toEqual({ version: 0, unchanged: false, list: null })
  })
  it('T13 the first save is version 1; an equal list (other key order) bumps by 0; a change bumps by 1', async () => {
    const w = await setup()
    const a = await set(w)
    expect(a.body.payments.version).toBe(1)
    expect(a.body.payments.list.accounts).toHaveLength(3)
    const b0 = body() as any
    const reordered = { accounts: b0.accounts.map((p: any) => ({ ...p })).reverse().reverse(), defaultId: b0.defaultId, recipient: b0.recipient }
    const b = await set(w, { expectVersion: 1, list: reordered })
    expect(b.status).toBe(200)
    expect(b.body.payments.version).toBe(1)
    expect(stored(w).payments_version).toBe(1)
    const changed = { ...b0, recipient: 'Other Shop' }
    const c = await set(w, { expectVersion: 1, list: changed })
    expect(c.body.payments.version).toBe(2)
    expect(stored(w).payments_version).toBe(2)
    expect((await get(w)).body.payments.list.recipient).toBe('Other Shop')
  })
  it('T12 knownVersion equal -> unchanged:true with no list; older knownVersion gets the list', async () => {
    const w = await setup()
    await set(w)
    expect((await get(w, { knownVersion: 1 })).body.payments).toEqual({ version: 1, unchanged: true, list: null })
    const old = (await get(w, { knownVersion: 0 })).body.payments
    expect(old.unchanged).toBe(false)
    expect(old.list.recipient).toBe('Meenakshi Buttons')
  })
  it('T14 a wrong expectVersion -> Q3M24 and nothing changes', async () => {
    const w = await setup()
    await set(w)
    const r = await set(w, { expectVersion: 0, list: { ...body(), recipient: 'Other' } })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('Q3M24')
    expect(stored(w).payments_version).toBe(1)
    expect((stored(w).payments as any).recipient).toBe('Meenakshi Buttons')
  })
})

describe('T15-T17 rights and validation', () => {
  it('T15/T19 table missing: seat 1 writes, seat 2 may read but not write', async () => {
    const w = await setup()
    expect((await set(w, {}, T1)).status).toBe(200)
    expect((await get(w, {}, T2)).status).toBe(200)
    const r = await set(w, { expectVersion: 1 }, T2)
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('Q3M23')
  })
  it('T15/T16 with the table: flags decide; no row = refused; seat 1 is never checked', async () => {
    const w = await setup()
    w.company.seatRights = [{ seat_no: 2, flags: { seePayments: true, editPayments: false } }]
    expect((await get(w, {}, T2)).status).toBe(200)
    expect((await set(w, {}, T2)).body.code).toBe('Q3M23')
    w.company.seatRights = [{ seat_no: 2, flags: { seePayments: true, editPayments: true } }]
    expect((await set(w, {}, T2)).status).toBe(200)
    w.company.seatRights = [{ seat_no: 2, flags: { seePayments: false, editPayments: true } }]
    const g = await get(w, {}, T2)
    expect(g.status).toBe(403); expect(g.body.code).toBe('Q3M22')
    w.company.seatRights = []
    expect((await get(w, {}, T2)).body.code).toBe('Q3M22')
    expect((await set(w, { expectVersion: 1 }, T2)).body.code).toBe('Q3M23')
    w.company.seatRights = [{ seat_no: 2, flags: { seePayments: 'true', editPayments: 1 } }]
    expect((await get(w, {}, T2)).body.code).toBe('Q3M22')
    expect((await get(w, {}, T1)).status).toBe(200)
  })
  it('the company being down gives Q3M11 / Q3M12 for another seat, never for seat 1', async () => {
    const w = await setup()
    w.company.failRpc = 'unreachable'
    expect((await get(w, {}, T2)).body.code).toBe('Q3M11')
    w.company.failRpc = 'refused'
    expect((await set(w, {}, T2)).body.code).toBe('Q3M12')
    expect((await get(w, {}, T1)).status).toBe(200)
  })
  it('T17 invalid -> Q3M25, oversize -> Q3M26, shapeless -> Q3M03', async () => {
    const w = await setup()
    const bad = { ...body(), accounts: [{ id: 'a', name: 'A', kind: 'upi', upiId: 'nobank' }] }
    expect((await set(w, { list: bad })).body.code).toBe('Q3M25')
    expect((await set(w, { list: { ...body(), accounts: [] } })).body.code).toBe('Q3M25')
    const big = { ...body(), recipient: 'x'.repeat(40000) }
    const r = await set(w, { list: big })
    expect(r.status).toBe(413); expect(r.body.code).toBe('Q3M26')
    expect((await set(w, { list: 'text' })).body.code).toBe('Q3M03')
    expect((await set(w, { expectVersion: -1 })).body.code).toBe('Q3M03')
    expect(stored(w).payments_version).toBe(0)
  })
})

describe('T18 M05 missing, T20 duplicate, T21 logs', () => {
  it('T18 column missing -> Q3M27 on both', async () => {
    const w = await setup({ m05: false })
    const g = await get(w)
    expect(g.status).toBe(503); expect(g.body.code).toBe('Q3M27')
    expect((await set(w)).body.code).toBe('Q3M27')
  })
  it('T20 the same reqId twice -> Q3M13, the first stands', async () => {
    const w = await setup()
    const id = fresh()
    expect((await set(w, { reqId: id })).status).toBe(200)
    const again = await set(w, { reqId: id, expectVersion: 1, list: { ...body(), recipient: 'Other' } })
    expect(again.body.code).toBe('Q3M13')
    expect((stored(w).payments as any).recipient).toBe('Meenakshi Buttons')
  })
  it('a failed write gives the reqId back so a retry works', async () => {
    const w = await setup()
    const id = fresh()
    expect((await set(w, { reqId: id, expectVersion: 5 })).body.code).toBe('Q3M24')
    expect((await set(w, { reqId: id, expectVersion: 0 })).status).toBe(200)
  })
  it('T21 no list content, UPI id, IFSC or account number in any log row or log line', async () => {
    const w = await setup()
    await set(w); await get(w); await set(w, { list: { ...body(), accounts: [] } }); await set(w, {}, T2); await get(w, {}, T2)
    w.company.seatRights = []
    await get(w, {}, T2)
    const all = JSON.stringify([w.master.logs, w.logLines])
    for (const bad of ['meenakshibuttons@sbi', 'SBIN0040015', '54047475538', '112011011564', 'KAYPAY', '0798048A0284669', 'Meenakshi']) expect(all).not.toContain(bad)
    for (const l of w.master.logs) expect(l.detail === 'ok' || /^Q3M\d\d$/.test(l.detail), l.detail).toBe(true)
  })
  it('a revoked seat and a suspended company are refused', async () => {
    const w = await setup()
    w.master.seats[1]!.status = 'revoked'
    expect((await get(w, {}, T2)).body.code).toBe('Q3M07')
    w.master.companies[0]!.status = 'suspended'
    expect((await get(w, {}, T1)).body.code).toBe('Q3M06')
    expect((await set(w, {}, T1)).body.code).toBe('Q3M06')
  })
})

describe('T22 static SQL', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase', 'master', 'M05_payments.sql'), 'utf8')
  const code = sql.replace(/--[^\n]*/g, '')
  it('is additive, re-runnable and has the header', () => {
    expect(sql).toMatch(/NEVER RUN from the sandbox/)
    expect(sql).toMatch(/Safe to run more than once/)
    expect(code).toMatch(/add column if not exists payments jsonb not null default '\{\}'::jsonb/)
    expect(code).toMatch(/add column if not exists payments_version int not null default 0/)
    expect(code).not.toMatch(/\b(drop|delete|truncate|grant|create policy|disable row level security)\b/i)
    expect(code.match(/alter table/g)).toHaveLength(2)
  })
})
