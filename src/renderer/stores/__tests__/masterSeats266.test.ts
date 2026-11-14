// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SeatView } from '@shared/master/schemas'
import { confirmReady, confirmWords, resetButtonWords, seatActions } from '@shared/master/seatsView'
import { useMasterSeatsStore } from '../masterSeatsStore'

const seat = (no: number, o: Partial<SeatView> = {}): SeatView => ({ no, label: `Seat ${no}`, email: null, status: 'active', legacy: false, code: `CODE-${no}`, codeHint: `…${no}${no}`, createdAt: '2026-11-13T05:00:00.000Z', resetAt: null, devices: 0, lastSeenAt: null, ...o })
const COMPANY = { id: 'c1', label: 'Acme', maxSeats: 15, status: 'active' }
const ok = (s: SeatView) => ({ ok: true as const, data: s })
let list: ReturnType<typeof vi.fn>, reset: ReturnType<typeof vi.fn>, revoke: ReturnType<typeof vi.fn>, rename: ReturnType<typeof vi.fn>, regen: ReturnType<typeof vi.fn>
const st = () => useMasterSeatsStore.getState()

beforeEach(async () => {
  list = vi.fn(async () => ({ ok: true, data: { company: COMPANY, seats: [seat(1, { code: null }), seat(2), seat(3, { legacy: true, code: null })] } }))
  reset = vi.fn(async () => ok(seat(2, { code: 'NEW-2' })))
  revoke = vi.fn(async () => ok(seat(2, { status: 'revoked' })))
  rename = vi.fn(async () => ok(seat(2, { label: 'Counter' })))
  regen = vi.fn(async () => ok(seat(2, { code: 'REGEN-2' })))
  ;(window as unknown as { quot3: unknown }).quot3 = { master: { seatList: list, seatCreate: vi.fn(), seatReset: reset, seatRevoke: revoke, seatRename: rename, seatRegen: regen } }
  st().clear()
  await st().load()
})
afterEach(() => { delete (window as unknown as { quot3?: unknown }).quot3 })

describe('Phase 266 seat action rules (pure)', () => {
  it('seat 1 has no reset / delete / regenerate / rights button, only rename', () => {
    expect(seatActions(seat(1))).toEqual({ reset: false, delete: false, regen: false, rename: true, rights: false })
  })
  it('a normal seat gets everything; a legacy seat cannot regenerate and its reset button explains itself', () => {
    expect(seatActions(seat(2))).toEqual({ reset: true, delete: true, regen: true, rename: true, rights: true })
    expect(seatActions(seat(3, { legacy: true })).regen).toBe(false)
    expect(resetButtonWords(seat(3, { legacy: true }))).toBe('Reset to enable a code')
    expect(confirmWords('reset', seat(3, { legacy: true }))).toContain('has no code yet')
  })
  it('a removed seat has no buttons at all', () => {
    expect(seatActions(seat(2, { status: 'revoked' }))).toEqual({ reset: false, delete: false, regen: false, rename: false, rights: false })
  })
  it('delete needs exactly DELETE; the words for reset and regenerate are the owner wording', () => {
    expect(confirmReady('delete', 'delete')).toBe(false)
    expect(confirmReady('delete', ' DELETE ')).toBe(true)
    expect(confirmReady('reset', '')).toBe(true)
    expect(confirmWords('reset', seat(2))).toContain('Everyone on this seat will reconnect by themselves')
    expect(confirmWords('regen', seat(2))).toContain('old code stops working at once')
    expect(confirmWords('regen', seat(2))).toContain('already linked keep working')
  })
})

describe('Phase 266 seats store actions', () => {
  it('reset asks first, makes no call until confirmed, then shows the new code and reloads', async () => {
    st().ask('reset', 2)
    expect(st().pending).toEqual({ kind: 'reset', no: 2 })
    expect(reset).not.toHaveBeenCalled()
    expect(await st().confirm()).toBe(true)
    expect(reset).toHaveBeenCalledWith({ seatNo: 2 })
    expect(st().newCode).toEqual({ no: 2, label: 'Seat 2', code: 'NEW-2' })
    expect(st().pending).toBeNull()
    expect(st().done).toContain('reconnect by themselves')
    expect(list).toHaveBeenCalledTimes(2)
  })
  it('seat 1 cannot be reset, deleted or regenerated: no pending action, no call', async () => {
    for (const k of ['reset', 'delete', 'regen'] as const) { st().ask(k, 1); expect(st().pending).toBeNull(); expect(st().error).not.toBe('') }
    expect(reset).not.toHaveBeenCalled(); expect(revoke).not.toHaveBeenCalled(); expect(regen).not.toHaveBeenCalled()
  })
  it('delete is blocked until DELETE is typed, then revokes', async () => {
    st().ask('delete', 2)
    expect(await st().confirm()).toBe(false)
    expect(revoke).not.toHaveBeenCalled()
    st().setTyped('del')
    expect(await st().confirm()).toBe(false)
    st().setTyped('DELETE')
    expect(await st().confirm()).toBe(true)
    expect(revoke).toHaveBeenCalledWith({ seatNo: 2 })
    expect(st().done).toBe('Seat 2 was deleted.')
  })
  it('regenerate shows the new code and says the old one stopped', async () => {
    st().ask('regen', 2)
    expect(await st().confirm()).toBe(true)
    expect(regen).toHaveBeenCalledWith({ seatNo: 2 })
    expect(st().newCode?.code).toBe('REGEN-2')
    expect(st().done).toContain('old code no longer works')
  })
  it('a legacy seat has no regenerate; asking gives the "reset first" words', () => {
    st().ask('regen', 3)
    expect(st().pending).toBeNull()
    expect(st().error).toBe('This seat has no code yet. Reset it first to make one.')
  })
  it('rename sends the trimmed name; an empty name makes no call', async () => {
    st().ask('rename', 2)
    expect(st().renameLabel).toBe('Seat 2')
    st().setRenameLabel('   ')
    expect(await st().confirm()).toBe(false)
    expect(rename).not.toHaveBeenCalled()
    expect(st().error).toBe('Type a name for the new seat.')
    st().setRenameLabel('  Counter ')
    expect(await st().confirm()).toBe(true)
    expect(rename).toHaveBeenCalledWith({ seatNo: 2, label: 'Counter' })
  })
  it('a master error shows its plain words and keeps the confirmation open', async () => {
    reset.mockResolvedValue({ ok: false, error: { message: 'Master unreachable. Try again later.' } })
    st().ask('reset', 2)
    expect(await st().confirm()).toBe(false)
    expect(st().error).toBe('Master unreachable. Try again later.')
    expect(st().pending).toEqual({ kind: 'reset', no: 2 })
    st().cancel()
    expect(st().pending).toBeNull()
  })
  it('Price List rights open for one seat and close when that seat is deleted', async () => {
    st().openRights(2)
    expect(st().rightsFor).toBe(2)
    st().ask('delete', 2); st().setTyped('DELETE')
    await st().confirm()
    expect(st().rightsFor).toBeNull()
  })
})
