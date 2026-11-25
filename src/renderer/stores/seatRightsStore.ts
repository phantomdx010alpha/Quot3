import { create } from 'zustand'
import type { Quot3Bridge, Result } from '@shared/ipc'
import { PRESETS, SEAT_RIGHT_FLAGS, type PresetName, type SeatFlag, type SeatFlags, type SeatRightsRow } from '@shared/seatRights'
import { phoneRightsErrorWords, shownFlags } from '@shared/seatRights'

type Bridge = Pick<Quot3Bridge, 'seatRights'>
const api = (): Partial<Bridge> | undefined => (window as unknown as { quot3?: Partial<Bridge> }).quot3
const NO_BRIDGE = 'The app could not be reached. Restart Quot3.'
const SOMETHING = 'Something went wrong. Try again.'
const fail = (r: Result<unknown>): string => (r.ok ? '' : phoneRightsErrorWords(r.error.code, r.error.message))

/**
 * Phase 287 (M25) - Settings > Company seats > Phone rights (seat 1 only). One draft per seat; "Save" sends the eleven flags through
 * `window.quot3.seatRights`. A seat the server never configured is shown as the Staff preset ("Staff (default)") until it is saved.
 * Selectors must return raw values (Phase 92 rule).
 */
export interface SeatRightsState {
  rows: SeatRightsRow[]
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  error: string
  busy: boolean
  /** The seat whose block is open (null = none). */
  openFor: number | null
  draft: Record<number, SeatFlags>
  savedSeat: number | null
  open: (seatNo: number | null) => void
  load: () => Promise<void>
  flagsOf: (seatNo: number) => SeatFlags
  isChanged: (seatNo: number) => boolean
  setFlag: (seatNo: number, flag: SeatFlag, on: boolean) => void
  applyPreset: (seatNo: number, preset: PresetName) => void
  save: (seatNo: number) => Promise<void>
  reset: () => void
}

const EMPTY = { rows: [] as SeatRightsRow[], status: 'idle' as const, error: '', busy: false, openFor: null as number | null, draft: {} as Record<number, SeatFlags>, savedSeat: null as number | null }

export const useSeatRightsStore = create<SeatRightsState>()((set, get) => ({
  ...EMPTY,
  open: (seatNo) => set({ openFor: seatNo, savedSeat: null, error: '' }),
  load: async () => {
    const b = api()?.seatRights
    if (!b) { set({ status: 'error', error: NO_BRIDGE }); return }
    set({ status: 'loading', error: '' })
    try {
      const r = await b.list()
      if (r.ok) { set({ rows: r.data, status: 'ready', error: '' }); return }
      set({ status: r.error.code === 'not_available' ? 'unavailable' : 'error', error: fail(r) })
    } catch { set({ status: 'error', error: SOMETHING }) }
  },
  flagsOf: (seatNo) => {
    const d = get().draft[seatNo]
    if (d) return d
    const row = get().rows.find((r) => r.seatNo === seatNo)
    return row ? shownFlags(row) : { ...PRESETS.Staff }
  },
  isChanged: (seatNo) => {
    const row = get().rows.find((r) => r.seatNo === seatNo)
    if (!row) return false
    if (!row.configured) return true // saving the default makes it explicit
    const f = get().flagsOf(seatNo)
    return SEAT_RIGHT_FLAGS.some((k) => f[k] !== row.flags[k])
  },
  setFlag: (seatNo, flag, on) => set((s) => ({ draft: { ...s.draft, [seatNo]: { ...get().flagsOf(seatNo), [flag]: on } }, savedSeat: null })),
  applyPreset: (seatNo, preset) => set((s) => ({ draft: { ...s.draft, [seatNo]: { ...PRESETS[preset] } }, savedSeat: null })),
  save: async (seatNo) => {
    const b = api()?.seatRights
    if (!b) { set({ error: NO_BRIDGE }); return }
    if (seatNo === 1) { set({ error: 'Seat 1 always has every right.' }); return }
    set({ busy: true, error: '', savedSeat: null })
    try {
      const r = await b.set({ seatNo, flags: get().flagsOf(seatNo) })
      if (!r.ok) { set({ error: fail(r) }); return }
      set((s) => {
        const draft = { ...s.draft }
        delete draft[seatNo]
        const has = s.rows.some((x) => x.seatNo === seatNo)
        const rows = has ? s.rows.map((x) => (x.seatNo === seatNo ? { ...r.data, branchName: r.data.branchName ?? x.branchName } : x)) : [...s.rows, r.data].sort((a, c) => a.seatNo - c.seatNo)
        return { rows, draft, savedSeat: seatNo }
      })
    } catch { set({ error: SOMETHING }) } finally { set({ busy: false }) }
  },
  reset: () => set({ ...EMPTY })
}))
