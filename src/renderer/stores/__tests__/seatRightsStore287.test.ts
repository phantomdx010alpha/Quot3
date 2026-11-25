import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRESETS, type SeatFlags, type SeatRightsRow } from '@shared/seatRights'
import { useSeatRightsStore } from '../seatRightsStore'

// Phase 287 (M25): the Phone rights store. Fake bridge, invented data.
const row = (seatNo: number, o: Partial<SeatRightsRow> = {}): SeatRightsRow => ({ seatNo, branchName: `Branch ${seatNo}`, flags: { ...PRESETS.Viewer }, configured: true, updatedAt: '2026-11-24T10:00:00.000Z', ...o })
const list = vi.fn()
const set = vi.fn()
const g = globalThis as unknown as { window: { quot3?: unknown } }
beforeEach(() => {
  list.mockReset(); set.mockReset()
  g.window = { quot3: { seatRights: { list, set } } }
  useSeatRightsStore.getState().reset()
})

describe('Phase 287 seatRightsStore', () => {
  it('loads the list; an unconfigured seat shows the Staff preset and can be saved straight away', async () => {
    list.mockResolvedValue({ ok: true, data: [row(1), row(2, { configured: false, flags: { ...PRESETS.Full, seeSales: false }, updatedAt: null }), row(3)] })
    await useSeatRightsStore.getState().load()
    const s = useSeatRightsStore.getState()
    expect(s.status).toBe('ready')
    expect(s.flagsOf(2)).toEqual(PRESETS.Staff)
    expect(s.isChanged(2)).toBe(true)
    expect(s.isChanged(3)).toBe(false)
  })
  it('toggling and presets change the draft only; Save sends all eleven flags and clears the draft', async () => {
    list.mockResolvedValue({ ok: true, data: [row(3)] })
    await useSeatRightsStore.getState().load()
    const st = useSeatRightsStore.getState()
    st.setFlag(3, 'deleteBills', true)
    expect(useSeatRightsStore.getState().isChanged(3)).toBe(true)
    expect(list).toHaveBeenCalledTimes(1)
    const sent: SeatFlags = { ...PRESETS.Viewer, deleteBills: true }
    set.mockResolvedValue({ ok: true, data: row(3, { flags: sent, updatedAt: '2026-11-24T11:00:00.000Z' }) })
    await useSeatRightsStore.getState().save(3)
    expect(set).toHaveBeenCalledWith({ seatNo: 3, flags: sent })
    const after = useSeatRightsStore.getState()
    expect(after.savedSeat).toBe(3)
    expect(after.draft[3]).toBeUndefined()
    expect(after.rows[0]!.updatedAt).toBe('2026-11-24T11:00:00.000Z')
    expect(after.isChanged(3)).toBe(false)
    after.applyPreset(3, 'Staff')
    expect(useSeatRightsStore.getState().flagsOf(3)).toEqual(PRESETS.Staff)
  })
  it('refusal, offline and "not available" are shown in plain words and nothing is marked saved', async () => {
    list.mockResolvedValue({ ok: false, error: { code: 'not_available', message: 'x' } })
    await useSeatRightsStore.getState().load()
    expect(useSeatRightsStore.getState().status).toBe('unavailable')
    expect(useSeatRightsStore.getState().error).toContain('SQL file 23')
    list.mockResolvedValue({ ok: true, data: [row(2)] })
    await useSeatRightsStore.getState().load()
    set.mockResolvedValue({ ok: false, error: { code: 'seat1_only', message: 'x' } })
    useSeatRightsStore.getState().setFlag(2, 'seeSales', false)
    await useSeatRightsStore.getState().save(2)
    expect(useSeatRightsStore.getState().error).toContain('seat 1')
    expect(useSeatRightsStore.getState().savedSeat).toBeNull()
    set.mockResolvedValue({ ok: false, error: { code: 'SYNC_OFFLINE', message: 'x' } })
    await useSeatRightsStore.getState().save(2)
    expect(useSeatRightsStore.getState().error).toContain('Nothing was saved')
    expect(useSeatRightsStore.getState().draft[2]).toBeDefined() // the draft stays so the owner can retry
  })
  it('seat 1 is never saved from here, and a missing bridge says so', async () => {
    await useSeatRightsStore.getState().save(1)
    expect(set).not.toHaveBeenCalled()
    g.window = {}
    await useSeatRightsStore.getState().load()
    expect(useSeatRightsStore.getState().status).toBe('error')
  })
})
