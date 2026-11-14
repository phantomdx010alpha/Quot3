import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PriceRightsInfo, PriceSeatRightsRow } from '@shared/pricelist/api'
import { ALL_RIGHTS, NO_RIGHTS, type PermFlags } from '@shared/pricelist/perms'
import { usePriceRightsStore } from '../priceRightsStore'

// Phase 242 (M23): the rights store. The bridge is mocked; invented seats only.
const st = () => usePriceRightsStore.getState()
const ok = <T,>(data: T) => ({ ok: true as const, data })
const bad = (message: string) => ({ ok: false as const, error: { code: 'VALIDATION', message } })
let info: PriceRightsInfo
let seats: PriceSeatRightsRow[]
let calls: string[]
let setReply: (seatNo: number, flags: PermFlags) => unknown

beforeEach(() => {
  info = { seatNo: 2, syncActive: true, isSeat1: false, flags: { ...NO_RIGHTS, add: true }, refused: 0, checkedAt: null, answeredAt: null, lastError: '', refusedNeeds: [] }
  seats = [{ seatNo: 1, branchName: 'Main', updatedAt: null, flags: { ...ALL_RIGHTS } }, { seatNo: 2, branchName: null, updatedAt: null, flags: { ...NO_RIGHTS } }]
  calls = []
  setReply = (seatNo, flags) => ok({ seatNo, branchName: null, updatedAt: '2026-11-13T00:00:00Z', flags })
  vi.stubGlobal('window', { quot3: { pricelist: {
    perms: async (i?: { refresh?: boolean }) => { calls.push(`perms:${i?.refresh === true}`); return ok(info) },
    permsList: async () => { calls.push('list'); return ok(seats) },
    permsSet: async (i: { seatNo: number; flags: PermFlags }) => { calls.push(`set:${i.seatNo}`); return setReply(i.seatNo, i.flags) }
  } } })
  usePriceRightsStore.setState({ info: null, flags: ALL_RIGHTS, seats: [], error: '', busy: false, savedSeat: null })
})

describe('priceRightsStore (Phase 242)', () => {
  it('starts with every right so nothing flickers, then takes what the main process says', async () => {
    expect(st().flags).toEqual(ALL_RIGHTS)
    await st().load(true)
    expect(calls).toEqual(['perms:true'])
    expect(st().flags).toEqual({ ...NO_RIGHTS, add: true })
    expect(st().info?.seatNo).toBe(2)
  })
  it('a failed or missing bridge keeps the last answer and never throws', async () => {
    await st().load()
    vi.stubGlobal('window', { quot3: { pricelist: { perms: async () => { throw new Error('x') } } } })
    await expect(st().load(true)).resolves.toBeUndefined()
    expect(st().flags).toEqual({ ...NO_RIGHTS, add: true })
    vi.stubGlobal('window', {})
    await expect(st().load()).resolves.toBeUndefined()
  })
  it('loads the seat table, and saving one seat replaces only that row', async () => {
    await st().loadSeats()
    expect(st().seats.map((s) => s.seatNo)).toEqual([1, 2])
    await st().saveSeat(2, { ...NO_RIGHTS, edit: true })
    expect(calls).toEqual(['list', 'set:2'])
    expect(st().seats.find((s) => s.seatNo === 2)?.flags.edit).toBe(true)
    expect(st().seats.find((s) => s.seatNo === 1)?.flags).toEqual(ALL_RIGHTS)
    expect(st().savedSeat).toBe(2)
    expect(st().error).toBe('')
  })
  it('a refusal shows the plain words and leaves the table as it was', async () => {
    await st().loadSeats()
    setReply = () => bad('Only the main branch (seat 1) can change who may edit the Price List.')
    await st().saveSeat(2, { ...ALL_RIGHTS })
    expect(st().error).toContain('seat 1')
    expect(st().savedSeat).toBeNull()
    expect(st().seats.find((s) => s.seatNo === 2)?.flags).toEqual(NO_RIGHTS)
    expect(st().busy).toBe(false)
  })
  it('a new seat is added in order; reset clears the table', async () => {
    await st().saveSeat(5, { ...NO_RIGHTS })
    await st().saveSeat(3, { ...NO_RIGHTS })
    expect(st().seats.map((s) => s.seatNo)).toEqual([3, 5])
    st().reset()
    expect(st().seats).toEqual([])
  })
})
