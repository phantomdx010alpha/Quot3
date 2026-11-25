import { describe, expect, it } from 'vitest'
import { AppError } from '../../ipc/envelope'
import { seatRightsHandlers } from '../../ipc/seatRights'
import { InMemorySharedServer, InMemorySharedTransport } from '../../sync/sharedTransport'
import { createSeatRightsService, SEAT_RIGHTS_CACHE_KEY, NOT_AVAILABLE_TEXT } from '../seatRightsService'
import { ALL_SEAT_RIGHTS, PRESETS, effectiveRights, normalizeSeatFlags, type SeatFlags } from '../../../shared/seatRights'

// Phase 286 (M25): the desktop rights service against the in-memory server (the rules of supabase/sql/23_seat_rights.sql). Invented data only.
const KEY = 'Q3-ABCD-EFGH-JKLM'
async function make(o: { asSeat?: number } = {}) {
  const server = new InMemorySharedServer({ now: () => Date.UTC(2026, 10, 24, 10, 0, 0) })
  const { orgId } = server.addOrg({ licenseKey: KEY, seats: [1, 2, 3].map((n) => ({ email: `seat${n}@example.com`, password: `pw${n}` })) })
  const transportFor = async (n: number) => { const t = new InMemorySharedTransport(server); await t.signIn({ email: `seat${n}@example.com`, password: `pw${n}` }); return t }
  const seat = o.asSeat ?? 1
  const t = await transportFor(seat)
  const store = new Map<string, string>()
  const svc = createSeatRightsService({
    sync: { get: (k) => store.get(k), set: (k, v) => { store.set(k, v) } },
    syncActive: () => true, seatNo: () => seat, connect: async () => ({ transport: t, creds: { license: KEY } }),
    log: { info: () => undefined, warn: () => undefined }
  }, { now: () => new Date('2026-11-24T10:00:00.000Z') })
  return { server, orgId, svc, store, transportFor }
}
const staff = (): SeatFlags => ({ ...PRESETS.Staff })

describe('Phase 286 seat rights service + transport', () => {
  it('seat 1 sets another seat, a phone seat reads its own row, and the doorbell rings', async () => {
    const m = await make()
    const before = m.server.pingSeq(m.orgId)
    const row = await m.svc.set(2, { ...PRESETS.Viewer })
    expect(row.configured).toBe(true)
    expect(row.flags).toEqual(PRESETS.Viewer)
    expect(m.server.pingSeq(m.orgId)).toBe(before + 1)
    const phone = await (await m.transportFor(2)).seatRightsGet({ license: KEY })
    expect(phone).toEqual({ seatNo: 2, flags: PRESETS.Viewer, configured: true })
    // the phone applies the contract: configured + server knows -> its row
    expect(effectiveRights({ seatNo: 2, linked: true, granted: phone.flags, configured: phone.configured, serverKnows: 'yes' })).toEqual(PRESETS.Viewer)
  })
  it('a Save that changes nothing rings nothing', async () => {
    const m = await make()
    await m.svc.set(2, staff())
    const seq = m.server.pingSeq(m.orgId)
    await m.svc.set(2, staff())
    expect(m.server.pingSeq(m.orgId)).toBe(seq)
    await m.svc.set(2, { ...staff(), deleteBills: true })
    expect(m.server.pingSeq(m.orgId)).toBe(seq + 1)
  })
  it('a seat nobody configured reads "configured: false" (the phone then uses Staff)', async () => {
    const m = await make()
    const a = await (await m.transportFor(3)).seatRightsGet({ license: KEY })
    expect(a.configured).toBe(false)
    expect(a.flags).toEqual(normalizeSeatFlags({}))
    const rows = await m.svc.list()
    expect(rows.map((r) => [r.seatNo, r.configured])).toEqual([[1, true], [2, false], [3, false]])
    expect(effectiveRights({ seatNo: 3, linked: true, granted: a.flags, configured: a.configured, serverKnows: 'yes' })).toEqual(PRESETS.Staff)
  })
  it('seat 1 cannot be restricted: its row is forced all-true', async () => {
    const m = await make()
    const row = await m.svc.set(1, normalizeSeatFlags({}))
    expect(row.flags).toEqual(ALL_SEAT_RIGHTS)
    expect((await (await m.transportFor(1)).seatRightsGet({ license: KEY })).flags).toEqual(ALL_SEAT_RIGHTS)
  })
  it('seeded existing seats get everything (what SQL 23 does at migration)', async () => {
    const m = await make()
    m.server.seedSeatRights(m.orgId)
    const rows = await m.svc.list()
    expect(rows.every((r) => r.configured && SEAT_FLAGS_ALL(r.flags))).toBe(true)
  })
  it('a non-seat-1 caller gets seat1_only for list and set', async () => {
    const m = await make({ asSeat: 2 })
    await expect(m.svc.list()).rejects.toMatchObject({ code: 'seat1_only' })
    await expect(m.svc.set(3, staff())).rejects.toMatchObject({ code: 'seat1_only' })
  })
  it('the server also refuses a non-seat-1 caller (Q3P02) and bad input (Q3I01)', async () => {
    const m = await make()
    const t2 = await m.transportFor(2)
    await expect(t2.seatRightsList({ license: KEY })).rejects.toMatchObject({ kind: 'seat1_only' })
    await expect(t2.seatRightsSet({ license: KEY, seatNo: 3, flags: staff() })).rejects.toMatchObject({ kind: 'seat1_only' })
    const t1 = await m.transportFor(1)
    await expect(t1.seatRightsSet({ license: KEY, seatNo: 9, flags: staff() })).rejects.toMatchObject({ kind: 'invalid_input' })
    await expect(t1.seatRightsSet({ license: KEY, seatNo: 0, flags: staff() })).rejects.toMatchObject({ kind: 'invalid_input' })
  })
  it('an old company project (no SQL 23) answers not_available; the phone side then has everything except editPayments', async () => {
    const m = await make()
    m.server.setRightsInstalled(m.orgId, false)
    await expect(m.svc.list()).rejects.toMatchObject({ code: 'not_available', message: NOT_AVAILABLE_TEXT })
    await expect(m.svc.set(2, staff())).rejects.toMatchObject({ code: 'not_available' })
    await expect((await m.transportFor(2)).seatRightsGet({ license: KEY })).rejects.toMatchObject({ kind: 'not_installed' })
    expect(effectiveRights({ seatNo: 2, linked: true, granted: undefined, configured: null, serverKnows: 'no' })).toEqual({ ...ALL_SEAT_RIGHTS, editPayments: false })
  })
  it('without shared sync the service refuses (nothing to set)', async () => {
    const m = await make()
    const svc = createSeatRightsService({ sync: { get: () => undefined, set: () => undefined }, syncActive: () => false, seatNo: () => null, connect: async () => { throw new Error('no') }, log: { info: () => undefined, warn: () => undefined } })
    await expect(svc.list()).rejects.toBeInstanceOf(AppError)
    expect(m).toBeDefined()
  })
  it('a list is cached; the cache survives a later offline failure; a bad value is refused before any call', async () => {
    const m = await make()
    await m.svc.set(2, staff())
    await m.svc.list()
    expect(m.store.get(SEAT_RIGHTS_CACHE_KEY)).toBeDefined()
    expect(m.svc.cached()?.rows).toHaveLength(3)
    m.server.setOffline(true)
    await expect(m.svc.list()).rejects.toMatchObject({ code: 'SYNC_OFFLINE' })
    expect(m.svc.cached()?.rows[1]?.flags).toEqual(PRESETS.Staff)
    m.server.setOffline(false)
    await expect(m.svc.set(2, { seeAddress: true })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(m.svc.set(51, staff())).rejects.toMatchObject({ code: 'VALIDATION' })
  })
  it('IPC: strict zod input (eleven booleans, seat 1..50, no extra keys) and the envelope', async () => {
    const m = await make()
    const h = seatRightsHandlers(m.svc)
    expect(Object.keys(h).sort()).toEqual(['seatRights:list', 'seatRights:set'])
    const ok = (await h['seatRights:set']!({ seatNo: 2, flags: staff() })) as { ok: boolean; data: { flags: SeatFlags } }
    expect(ok.ok).toBe(true)
    expect(ok.data.flags).toEqual(staff())
    const bad = async (v: unknown) => ((await h['seatRights:set']!(v)) as { ok: boolean }).ok
    expect(await bad({ seatNo: 2, flags: { ...staff(), extra: true } })).toBe(false)
    expect(await bad({ seatNo: 2, flags: { seeAddress: true } })).toBe(false)
    expect(await bad({ seatNo: 0, flags: staff() })).toBe(false)
    expect(await bad({ seatNo: 51, flags: staff() })).toBe(false)
    expect(await bad({ seatNo: 2, flags: staff(), more: 1 })).toBe(false)
    expect(await bad({ seatNo: 2, flags: { ...staff(), seeSales: 'yes' } })).toBe(false)
    const list = (await h['seatRights:list']!({})) as { ok: boolean; data: unknown[] }
    expect(list.ok).toBe(true)
    expect(list.data).toHaveLength(3)
    expect(((await h['seatRights:list']!({ x: 1 })) as { ok: boolean }).ok).toBe(false)
  })
})
const SEAT_FLAGS_ALL = (f: SeatFlags): boolean => Object.values(f).every((v) => v === true)
