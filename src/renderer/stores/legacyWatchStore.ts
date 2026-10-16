import { create } from 'zustand'
import type { Quot3Bridge, Result } from '@shared/ipc'
import { BACKGROUND_KEYS, readBackgroundSettings, type BackgroundSettings } from '@shared/background'
import { badgeCount, type ActivityItem, type ReviewAction, type ReviewLists } from '@shared/legacyWatch/reviewTypes'
import { INTERVAL_RANGE, LEGACY_WATCH_KEYS, readLegacyWatchSettings, type LegacyWatchSettings, type LegacyWatchStatus } from '@shared/legacyWatch/watchConfig'

type Bridge = Pick<Quot3Bridge, 'legacyWatch' | 'settings'>
const api = (): Partial<Bridge> | undefined => (window as unknown as { quot3?: Partial<Bridge> }).quot3

const DEFAULT_WATCH: LegacyWatchSettings = { enabled: false, folder: '', intervalSeconds: INTERVAL_RANGE.default }
const DEFAULT_BG: BackgroundSettings = { startWithWindows: false, keepRunning: false }

/** Phase 162 - Settings "Background and legacy watch": the saved switches, the live status and the last refused action. Selectors must return raw values (Phase 92 rule). */
export interface LegacyWatchUiState {
  loaded: boolean
  watch: LegacyWatchSettings
  background: BackgroundSettings
  status: LegacyWatchStatus | null
  /** Plain-words reason of the last refused action, '' = none. */
  error: string
  busy: boolean
  /** Phase 163: items waiting on the owner (badge), the lists and the last result line. */
  reviewCount: number
  review: ReviewLists
  activity: ActivityItem[]
  notice: string

  refreshCount: () => Promise<void>
  loadReview: () => Promise<void>
  loadActivity: () => Promise<void>
  resolveReview: (id: string, action: ReviewAction, billId?: string) => Promise<void>
  undoActivity: (id: string) => Promise<void>
  load: () => Promise<void>
  refreshStatus: () => Promise<void>
  setEnabled: (v: boolean) => Promise<void>
  setInterval: (seconds: number) => Promise<void>
  setBackground: (key: keyof BackgroundSettings, v: boolean) => Promise<void>
  pickFolder: () => Promise<void>
  scanNow: () => Promise<void>
  setPaused: (paused: boolean) => Promise<void>
}

const NO_REVIEW: ReviewLists = { open: [], ignored: [] }
const fail = (r: Result<unknown>): string => (r.ok ? '' : r.error.message)

export const useLegacyWatchStore = create<LegacyWatchUiState>()((set, get) => {
  /** Run one bridge call; a refused / thrown call becomes a plain message, a good one stores the status. */
  const act = async (fn: (b: Partial<Bridge>) => Promise<Result<LegacyWatchStatus | null>> | undefined): Promise<void> => {
    const b = api()
    if (!b?.legacyWatch) { set({ error: 'The app could not be reached. Restart Quot3.' }); return }
    set({ busy: true, error: '' })
    try {
      const r = await fn(b)
      if (!r) return
      if (!r.ok) { set({ error: fail(r) }); return }
      if (r.data) set({ status: r.data })
    } catch { set({ error: 'Something went wrong. Try again.' }) } finally { set({ busy: false }) }
  }
  const save = async (key: string, value: unknown): Promise<boolean> => {
    const b = api()
    if (!b?.settings) { set({ error: 'The app could not be reached. Restart Quot3.' }); return false }
    try {
      const r = await b.settings.set(key, value)
      if (!r.ok) { set({ error: fail(r) }); return false }
      return true
    } catch { set({ error: 'The setting could not be saved. Try again.' }); return false }
  }
  const reloadSettings = async (): Promise<void> => {
    const b = api()
    if (!b?.settings) return
    const r = await b.settings.getAll()
    if (r.ok) set({ watch: readLegacyWatchSettings(r.data), background: readBackgroundSettings(r.data) })
  }

  return {
    loaded: false, watch: DEFAULT_WATCH, background: DEFAULT_BG, status: null, error: '', busy: false,
    reviewCount: 0, review: NO_REVIEW, activity: [], notice: '',

    refreshCount: async () => {
      const b = api()
      if (!b?.legacyWatch?.reviewCount) return
      try { const r = await b.legacyWatch.reviewCount(); if (r.ok) set({ reviewCount: badgeCount(r.data.count) }) } catch { /* the next poll tries again */ }
    },
    loadReview: async () => {
      const b = api()
      if (!b?.legacyWatch?.reviewList) return
      try {
        const r = await b.legacyWatch.reviewList()
        if (r.ok) set({ review: r.data, reviewCount: badgeCount(r.data.open.length) }); else set({ error: fail(r) })
      } catch { set({ error: 'The review list could not be read.' }) }
    },
    loadActivity: async () => {
      const b = api()
      if (!b?.legacyWatch?.activityList) return
      try { const r = await b.legacyWatch.activityList(); if (r.ok) set({ activity: r.data }); else set({ error: fail(r) }) } catch { set({ error: 'The activity list could not be read.' }) }
    },
    resolveReview: async (id, action, billId) => {
      const b = api()
      if (!b?.legacyWatch?.reviewResolve) { set({ error: 'The app could not be reached. Restart Quot3.' }); return }
      set({ busy: true, error: '', notice: '' })
      try {
        const r = await b.legacyWatch.reviewResolve(billId === undefined ? { id, action } : { id, action, billId })
        if (!r.ok) set({ error: fail(r) }); else set({ notice: r.data.message })
      } catch { set({ error: 'Something went wrong. Try again.' }) } finally { set({ busy: false }) }
      await get().loadReview(); await get().loadActivity(); await get().refreshStatus()
    },
    undoActivity: async (id) => {
      const b = api()
      if (!b?.legacyWatch?.activityUndo) { set({ error: 'The app could not be reached. Restart Quot3.' }); return }
      set({ busy: true, error: '', notice: '' })
      try {
        const r = await b.legacyWatch.activityUndo(id)
        if (!r.ok) set({ error: fail(r) }); else set({ notice: r.data.message })
      } catch { set({ error: 'Something went wrong. Try again.' }) } finally { set({ busy: false }) }
      await get().loadActivity(); await get().loadReview()
    },

    load: async () => {
      try { await reloadSettings() } catch { set({ error: 'The settings could not be read.' }) }
      await get().refreshStatus()
      set({ loaded: true })
    },
    refreshStatus: async () => {
      const b = api()
      if (!b?.legacyWatch) return
      try { const r = await b.legacyWatch.status(); if (r.ok) set({ status: r.data }) } catch { /* the next poll tries again */ }
    },
    setEnabled: async (v) => {
      if (!(await save(LEGACY_WATCH_KEYS.enabled, v))) return
      await reloadSettings(); await get().refreshStatus()
    },
    setInterval: async (seconds) => {
      if (!Number.isInteger(seconds) || seconds < INTERVAL_RANGE.min || seconds > INTERVAL_RANGE.max) { set({ error: `Enter a whole number of seconds from ${INTERVAL_RANGE.min} to ${INTERVAL_RANGE.max}.` }); return }
      set({ error: '' })
      if (!(await save(LEGACY_WATCH_KEYS.intervalSeconds, seconds))) return
      await reloadSettings(); await get().refreshStatus()
    },
    setBackground: async (key, v) => {
      set({ error: '' })
      if (!(await save(BACKGROUND_KEYS[key], v))) return
      await reloadSettings()
    },
    pickFolder: async () => {
      await act((b) => b.legacyWatch?.pickFolder())
      await reloadSettings()
    },
    scanNow: () => act((b) => b.legacyWatch?.scanNow()),
    setPaused: (paused) => act((b) => b.legacyWatch?.pause(paused))
  }
})
