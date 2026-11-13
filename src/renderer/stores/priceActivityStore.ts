import { create } from 'zustand'
import type { Quot3Bridge, Result } from '@shared/ipc'
import type { PriceActivityAccess, PriceActivitySource } from '@shared/pricelist/api'
import type { PriceLogRow } from '@shared/pricelist/apiLog'
import { LOG_RETENTION_RANGE, PRICELIST_KEYS } from '@shared/pricelist/settings'

type Bridge = Pick<Quot3Bridge, 'pricelist' | 'settings'>
const api = (): Partial<Bridge> | undefined => (window as unknown as { quot3?: Partial<Bridge> }).quot3
const fail = (r: Result<unknown>): string => (r.ok ? '' : r.error.message)
const PAGE = 100

/**
 * Phase 243 (M23) - Settings > Price List > Activity (seat 1, or a PC without sync). `access.canView` decides if the section exists at all;
 * `access.visible` (the setting `pricelist.log.visible`) decides if the list is loaded. Selectors must return raw values (Phase 92 rule).
 */
export interface PriceActivityState {
  access: PriceActivityAccess | null
  source: PriceActivitySource | null
  rows: PriceLogRow[]
  next: number | null
  error: string
  busy: boolean
  load: () => Promise<void>
  more: () => Promise<void>
  setVisible: (on: boolean) => Promise<void>
  setRetention: (days: number) => Promise<void>
  exportCsv: () => Promise<boolean>
  reset: () => void
}

export const usePriceActivityStore = create<PriceActivityState>()((set, get) => {
  const readAccess = async (): Promise<PriceActivityAccess | null> => {
    const b = api()?.pricelist
    if (!b) return null
    try { const r = await b.activityAccess(); if (r.ok) { set({ access: r.data }); return r.data } } catch { /* the section just stays hidden */ }
    return null
  }
  const first = async (): Promise<void> => {
    const b = api()?.pricelist
    if (!b) return
    set({ busy: true, error: '' })
    try {
      const r = await b.activity({ limit: PAGE })
      if (!r.ok) set({ error: fail(r), rows: [], next: null })
      else set({ rows: r.data.rows, next: r.data.next ?? null, source: r.data.source })
    } catch { set({ error: 'Something went wrong. Try again.' }) } finally { set({ busy: false }) }
  }
  const save = async (key: string, value: unknown): Promise<boolean> => {
    const b = api()?.settings
    if (!b) { set({ error: 'The app could not be reached. Restart Quot3.' }); return false }
    try { const r = await b.set(key, value); if (!r.ok) { set({ error: fail(r) }); return false } return true } catch { set({ error: 'Something went wrong. Try again.' }); return false }
  }
  return {
    access: null, source: null, rows: [], next: null, error: '', busy: false,
    load: async () => {
      const a = await readAccess()
      if (a && a.canView && a.visible) await first()
      else set({ rows: [], next: null })
    },
    more: async () => {
      const b = api()?.pricelist
      const { next, busy } = get()
      if (!b || next === null || busy) return
      set({ busy: true, error: '' })
      try {
        const r = await b.activity({ limit: PAGE, beforeId: next })
        if (!r.ok) set({ error: fail(r) })
        else set((s) => ({ rows: [...s.rows, ...r.data.rows], next: r.data.next ?? null }))
      } catch { set({ error: 'Something went wrong. Try again.' }) } finally { set({ busy: false }) }
    },
    setVisible: async (on) => {
      set({ error: '' })
      if (await save(PRICELIST_KEYS.logVisible, on)) await get().load()
    },
    setRetention: async (days) => {
      const d = Math.max(LOG_RETENTION_RANGE.min, Math.min(LOG_RETENTION_RANGE.max, Math.round(Number.isFinite(days) ? days : 365)))
      set({ error: '' })
      if (await save(PRICELIST_KEYS.logRetentionDays, d)) set((s) => (s.access ? { access: { ...s.access, retentionDays: d } } : {}))
    },
    exportCsv: async () => {
      const b = api()?.pricelist
      if (!b) { set({ error: 'The app could not be reached. Restart Quot3.' }); return false }
      set({ busy: true, error: '' })
      try {
        const r = await b.activityCsv()
        if (!r.ok) { set({ error: fail(r) }); return false }
        const url = URL.createObjectURL(new Blob([r.data.csv], { type: 'text/csv;charset=utf-8' }))
        const a = document.createElement('a')
        a.href = url
        a.download = 'price-list-activity.csv'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        return true
      } catch { set({ error: 'Something went wrong. Try again.' }); return false } finally { set({ busy: false }) }
    },
    reset: () => set({ access: null, source: null, rows: [], next: null, error: '', busy: false })
  }
})
