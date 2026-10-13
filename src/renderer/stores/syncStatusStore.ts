import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import type { ConflictInfo } from '@shared/sync/conflict'
import { isProgress, type SyncProgress } from '@shared/sync/progress'
import { EMPTY_OVERVIEW, type SyncOverview } from '@shared/sync/manager'

type Api = Quot3Bridge['sync']
type Win = { quot3?: { sync?: Api; on?: Quot3Bridge['on'] } }
const bridge = (): Win['quot3'] => (window as unknown as Win).quot3
const NO_BRIDGE = 'Sync is not available (no connection to the app).'

/** Phase 59 - what the Sync status page and the Dashboard chip show. Main owns the truth; this store only mirrors it. */
export interface SyncStatusState {
  overview: SyncOverview
  /** True once main has answered at least once (the chip shows nothing before that). */
  loaded: boolean
  conflicts: ConflictInfo[]
  /** Phase 89: the run in progress, per direction (null = nothing running). */
  sending: SyncProgress | null
  receiving: SyncProgress | null
  busy: boolean
  error: string
  notice: string
  load: () => Promise<void>
  loadConflicts: () => Promise<void>
  setEnabled: (on: boolean) => Promise<boolean>
  retry: (ids?: number[]) => Promise<number>
  syncNow: () => Promise<boolean>
  dismissConflict: (billId: string) => Promise<boolean>
  clearMessages: () => void
}

const isOverview = (v: unknown): v is SyncOverview => typeof v === 'object' && v !== null && typeof (v as { mode?: unknown }).mode === 'string' && typeof (v as { chip?: unknown }).chip === 'string'

export const useSyncStatusStore = create<SyncStatusState>((set, get) => {
  /** Runs a call that answers a fresh overview; records the error or notice. */
  async function act<T>(call: (a: Api) => Promise<{ ok: true; data: T } | { ok: false; error: { message: string } }>, take: (d: T) => SyncOverview, notice: (d: T) => string): Promise<T | null> {
    const a = bridge()?.sync
    if (!a) { set({ error: NO_BRIDGE }); return null }
    set({ busy: true, error: '', notice: '' })
    try {
      const r = await call(a)
      if (!r.ok) { set({ busy: false, error: r.error.message }); return null }
      set({ busy: false, overview: take(r.data), loaded: true, notice: notice(r.data) })
      void get().loadConflicts()
      return r.data
    } catch {
      set({ busy: false, error: 'Something went wrong. Try again.' })
      return null
    }
  }
  return {
    overview: EMPTY_OVERVIEW, loaded: false, conflicts: [], sending: null, receiving: null, busy: false, error: '', notice: '',
    clearMessages: () => set({ error: '', notice: '' }),
    async load() {
      const a = bridge()?.sync
      if (!a) return
      try {
        const r = await a.status()
        if (r.ok) set({ overview: r.data, loaded: true })
      } catch { /* the page keeps showing the last status */ }
    },
    async loadConflicts() {
      const a = bridge()?.sync
      if (!a) return
      try {
        const r = await a.conflicts()
        if (r.ok) set({ conflicts: r.data })
      } catch { /* the list stays as it was */ }
    },
    async setEnabled(on) {
      const r = await act((a) => a.setEnabled(on), (d) => d, (d) => (d.enabled ? 'Sync is on.' : 'Sync is off. Changes are kept and will be sent when you switch it on.'))
      return r !== null
    },
    async retry(ids) {
      const r = await act((a) => a.retry(ids), (d) => d.overview, (d) => (d.retried === 0 ? 'Nothing needed a retry.' : `${d.retried} ${d.retried === 1 ? 'change was' : 'changes were'} put back in the queue.`))
      return r === null ? 0 : r.retried
    },
    async syncNow() {
      const r = await act((a) => a.now(), (d) => d, () => 'Checked with Supabase just now.')
      return r !== null
    },
    async dismissConflict(billId) {
      const a = bridge()?.sync
      if (!a) { set({ error: NO_BRIDGE }); return false }
      try {
        const r = await a.dismissConflict(billId)
        if (!r.ok) { set({ error: r.error.message }); return false }
        await Promise.all([get().load(), get().loadConflicts()])
        return r.data.done
      } catch { set({ error: 'Could not clear the conflict mark.' }); return false }
    }
  }
})

/** Loads the status once and keeps it fresh from main's `sync:status` event. Returns the stop function. */
export function startSyncStatus(): () => void {
  const b = bridge()
  if (!b?.sync) return () => undefined
  const store = useSyncStatusStore
  void store.getState().load()
  void store.getState().loadConflicts()
  const off = b.on?.('sync:status', (payload) => {
    if (!isOverview(payload)) return
    const before = store.getState().overview.conflicts
    store.setState({ overview: payload, loaded: true })
    if (payload.conflicts !== before) void store.getState().loadConflicts()
  })
  const offP = b.on?.('sync:progress', (p) => {
    if (!isProgress(p)) return
    store.setState(p.direction === 'send' ? { sending: p.active ? p : null } : { receiving: p.active ? p : null })
  })
  return () => { off?.(); offP?.() }
}

/** Palette action: flips the on / off switch (does nothing visible while no license is activated; the page says why). */
export async function toggleSync(): Promise<boolean> {
  const st = useSyncStatusStore.getState()
  await st.load()
  const o = useSyncStatusStore.getState().overview
  if (!o.activated) return false
  return useSyncStatusStore.getState().setEnabled(!o.enabled)
}
