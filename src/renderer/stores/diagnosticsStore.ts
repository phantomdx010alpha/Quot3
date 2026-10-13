import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import type { CrashNotice } from '@shared/diagnostics'

type Api = Quot3Bridge['diagnostics']
const api = (): Api | undefined => (window as unknown as { quot3?: { diagnostics?: Api } }).quot3?.diagnostics

/** Phase 61 - "Copy diagnostics" and the launch notice "Quot3 did not close properly last time". */
export interface DiagnosticsUiState {
  notice: CrashNotice | null
  loaded: boolean
  /** Result of the last Copy diagnostics ('' = none yet). */
  message: string
  failed: boolean
  loadNotice: () => Promise<void>
  dismissNotice: () => Promise<void>
  copy: () => Promise<boolean>
}

export const useDiagnosticsStore = create<DiagnosticsUiState>((set) => ({
  notice: null, loaded: false, message: '', failed: false,
  loadNotice: async () => {
    const a = api()
    if (!a) { set({ loaded: true }); return }
    try {
      const r = await a.crashNotice()
      set({ notice: r.ok ? r.data.notice : null, loaded: true })
    } catch { set({ loaded: true }) }
  },
  dismissNotice: async () => {
    set({ notice: null })
    try { await api()?.dismissCrash() } catch { /* the notice simply shows again next launch */ }
  },
  copy: async () => {
    const a = api()
    if (!a) { set({ message: 'Copying is not available (no connection to the app).', failed: true }); return false }
    try {
      const r = await a.copy()
      if (!r.ok) { set({ message: r.error.message, failed: true }); return false }
      set({ message: `Diagnostics copied (${r.data.lines} lines). Paste them into a message to support.`, failed: false })
      return true
    } catch {
      set({ message: 'Could not copy the diagnostics. Try again.', failed: true })
      return false
    }
  }
}))
