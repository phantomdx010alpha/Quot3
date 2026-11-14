// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SeatView } from '@shared/master/schemas'
import { canShowCode, lastSeenWords, validateSeatLabel } from '@shared/master/seatsView'
import { useMasterSeatsStore } from '../masterSeatsStore'

const seat = (no: number, o: Partial<SeatView> = {}): SeatView => ({ no, label: `Seat ${no}`, email: null, status: 'active', legacy: false, code: `CODE-${no}`, codeHint: `…${no}${no}`, createdAt: '2026-11-13T05:00:00.000Z', resetAt: null, devices: 0, lastSeenAt: null, ...o })
const COMPANY = { id: 'c1', label: 'Acme', maxSeats: 15, status: 'active' }
let list: ReturnType<typeof vi.fn>
let create: ReturnType<typeof vi.fn>
const reset = (): void => useMasterSeatsStore.getState().clear()

beforeEach(() => {
  list = vi.fn(async () => ({ ok: true, data: { company: COMPANY, seats: [seat(2), seat(1, { code: null, legacy: true })] } }))
  create = vi.fn()
  ;(window as unknown as { quot3: unknown }).quot3 = { master: { seatList: list, seatCreate: create } }
  reset()
})
afterEach(() => { delete (window as unknown as { quot3?: unknown }).quot3 })

describe('Phase 265 seats store', () => {
  it('load lists the seats sorted by number', async () => {
    await useMasterSeatsStore.getState().load()
    const s = useMasterSeatsStore.getState()
    expect(s.status).toBe('ready')
    expect(s.seats.map((x) => x.no)).toEqual([1, 2])
    expect(s.company?.maxSeats).toBe(15)
  })
  it('load failure shows the master words', async () => {
    list.mockResolvedValue({ ok: false, error: { message: 'Only the admin seat (seat 1) can do this.' } })
    await useMasterSeatsStore.getState().load()
    expect(useMasterSeatsStore.getState().error).toBe('Only the admin seat (seat 1) can do this.')
    expect(useMasterSeatsStore.getState().status).toBe('error')
  })
  it('add sends the trimmed name, keeps the new code once, and reloads the list', async () => {
    await useMasterSeatsStore.getState().load()
    create.mockResolvedValue({ ok: true, data: seat(3, { label: 'Sales PC', code: 'NEW-CODE-3' }) })
    useMasterSeatsStore.getState().setAddLabel('  Sales PC ')
    expect(await useMasterSeatsStore.getState().add()).toBe(true)
    expect(create).toHaveBeenCalledWith({ label: 'Sales PC' })
    expect(list).toHaveBeenCalledTimes(2)
    expect(useMasterSeatsStore.getState().newCode).toEqual({ no: 3, label: 'Sales PC', code: 'NEW-CODE-3' })
    expect(useMasterSeatsStore.getState().addLabel).toBe('')
    useMasterSeatsStore.getState().dismissNewCode()
    expect(useMasterSeatsStore.getState().newCode).toBeNull()
  })
  it('an empty name makes no call', async () => {
    await useMasterSeatsStore.getState().load()
    useMasterSeatsStore.getState().setAddLabel('   ')
    expect(await useMasterSeatsStore.getState().add()).toBe(false)
    expect(create).not.toHaveBeenCalled()
    expect(useMasterSeatsStore.getState().error).toBe('Type a name for the new seat.')
  })
  it('at 15 seats the cap message shows and no call is made', async () => {
    list.mockResolvedValue({ ok: true, data: { company: COMPANY, seats: Array.from({ length: 15 }, (_, i) => seat(i + 1)) } })
    await useMasterSeatsStore.getState().load()
    useMasterSeatsStore.getState().setAddLabel('One more')
    expect(await useMasterSeatsStore.getState().add()).toBe(false)
    expect(create).not.toHaveBeenCalled()
    expect(useMasterSeatsStore.getState().error).toBe('The seat limit of 15 is reached.')
  })
  it('a refusal from the master shows its plain words and leaves the name for a retry', async () => {
    await useMasterSeatsStore.getState().load()
    create.mockResolvedValue({ ok: false, error: { message: 'The company database could not be reached. Try again.' } })
    useMasterSeatsStore.getState().setAddLabel('Sales PC')
    expect(await useMasterSeatsStore.getState().add()).toBe(false)
    const s = useMasterSeatsStore.getState()
    expect(s.error).toBe('The company database could not be reached. Try again.')
    expect(s.addLabel).toBe('Sales PC')
    expect(s.newCode).toBeNull()
    expect(s.busy).toBe(false)
  })
  it('a thrown call says something generic; toggleShow flips one seat; clear forgets every code', async () => {
    await useMasterSeatsStore.getState().load()
    create.mockRejectedValue(new Error('boom CODE-2'))
    useMasterSeatsStore.getState().setAddLabel('X')
    expect(await useMasterSeatsStore.getState().add()).toBe(false)
    expect(useMasterSeatsStore.getState().error).toBe('Something went wrong. Try again.')
    useMasterSeatsStore.getState().toggleShow(2)
    expect(useMasterSeatsStore.getState().shown[2]).toBe(true)
    useMasterSeatsStore.getState().clear()
    expect(JSON.stringify(useMasterSeatsStore.getState())).not.toContain('CODE-2')
  })
  it('pure helpers: code only for active non-legacy seats with a code; last seen words; label rules', () => {
    expect(canShowCode(seat(2))).toBe(true)
    expect(canShowCode(seat(2, { legacy: true, code: null }))).toBe(false)
    expect(canShowCode(seat(2, { status: 'revoked' }))).toBe(false)
    expect(lastSeenWords(null)).toBe('Not yet')
    expect(lastSeenWords('not a date')).toBe('Not yet')
    expect(lastSeenWords('2026-11-13T05:00:00.000Z')).not.toBe('Not yet')
    expect(validateSeatLabel('x'.repeat(41))).toMatch(/under 41/)
    expect(validateSeatLabel('Counter')).toBe('')
  })
})
