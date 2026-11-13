import { create } from 'zustand'
import type { Quot3Bridge, Result } from '@shared/ipc'
import type { PriceRightsInfo, PriceSeatRightsRow } from '@shared/pricelist/api'
import { ALL_RIGHTS, normalizeFlags, type PermFlag, type PermFlags } from '@shared/pricelist/perms'

type Bridge = Pick<Quot3Bridge, 'pricelist'>
const api = (): Partial<Bridge> | undefined => (window as unknown as { quot3?: Partial<Bridge> }).quot3
const fail = (r: Result<unknown>): string => (r.ok ? '' : r.error.message)

/**
 * Phase 242 (M23) - what this seat may do in the Price List, and (seat 1 only) the table of who may edit.
 * Until the answer arrives every right counts as granted so nothing flickers: the service and the server still refuse a change that is not allowed.
 * Selectors must return raw values (Phase 92 rule).
 */
export interface PriceRightsState {
  info: PriceRightsInfo | null
  flags: PermFlags
  seats: PriceSeatRightsRow[]
  error: string
  busy: boolean
  savedSeat: number | null
  load: (refresh?: boolean) => Promise<void>
  loadSeats: () => Promise<void>
  saveSeat: (seatNo: number, flags: PermFlags) => Promise<void>
  reset: () => void
}

export const usePriceRightsStore = create<PriceRightsState>()((set, get) => ({
  info: null, flags: ALL_RIGHTS, seats: [], error: '', busy: false, savedSeat: null,
  load: async (refresh = false) => {
    const b = api()?.pricelist
    if (!b) return
    try {
      const r = await b.perms(refresh ? { refresh: true } : undefined)
      if (r.ok) set({ info: r.data, flags: normalizeFlags(r.data.flags) })
    } catch { /* best effort: keep what we had */ }
  },
  loadSeats: async () => {
    const b = api()?.pricelist
    if (!b) { set({ error: 'The app could not be reached. Restart Quot3.' }); return }
    set({ busy: true, error: '' })
    try {
      const r = await b.permsList()
      if (!r.ok) set({ error: fail(r) })
      else set({ seats: r.data })
    } catch { set({ error: 'Something went wrong. Try again.' }) } finally { set({ busy: false }) }
  },
  saveSeat: async (seatNo, flags) => {
    const b = api()?.pricelist
    if (!b) { set({ error: 'The app could not be reached. Restart Quot3.' }); return }
    set({ busy: true, error: '', savedSeat: null })
    try {
      const r = await b.permsSet({ seatNo, flags })
      if (!r.ok) { set({ error: fail(r) }); return }
      set((s) => ({ seats: s.seats.some((x) => x.seatNo === seatNo) ? s.seats.map((x) => (x.seatNo === seatNo ? r.data : x)) : [...s.seats, r.data].sort((a, c) => a.seatNo - c.seatNo), savedSeat: seatNo }))
    } catch { set({ error: 'Something went wrong. Try again.' }) } finally { set({ busy: false }) }
  },
  reset: () => set({ seats: [], error: '', busy: false, savedSeat: null })
}))

export type { PermFlag }
