import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import type { DashboardStats } from '@shared/dashboard/dashboardStats'

type Api = Quot3Bridge['dashboard']
const api = (): Api | undefined => (window as unknown as { quot3?: { dashboard?: Api } }).quot3?.dashboard

/** Phase 46 - the Dashboard numbers. `load()` is called on mount and when the window regains focus; a failed refresh keeps the old numbers. */
interface DashboardState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  stats: DashboardStats | null
  load: () => Promise<void>
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  status: 'idle',
  error: '',
  stats: null,
  async load() {
    const a = api()
    if (!a) { set({ status: 'error', error: 'Not connected to the app' }); return }
    if (get().status === 'loading') return
    set({ status: get().stats ? 'ready' : 'loading', error: '' })
    try {
      const r = await a.stats()
      if (!r.ok) { set({ status: 'error', error: r.error.message }); return }
      set({ status: 'ready', stats: r.data, error: '' })
    } catch (e) {
      set({ status: 'error', error: `Could not load the dashboard: ${e instanceof Error ? e.message : 'unknown error'}` })
    }
  }
}))
