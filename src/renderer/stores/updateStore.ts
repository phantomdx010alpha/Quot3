import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import { initialUpdateState, type UpdateChannel, type UpdateState } from '@shared/updater'
import { useBillStore } from './billStore'
import { requestLeave } from './guardStore'

type Api = Quot3Bridge['updates']
type Win = { quot3?: { updates?: Api; on?: Quot3Bridge['on'] } }
const bridge = (): Win['quot3'] => (window as unknown as Win).quot3

/** Phase 62 - update state mirrored from main, plus the Settings > Updates actions. */
export interface UpdateUiState {
  state: UpdateState
  loaded: boolean
  /** The last refused request (bad address, install refused), '' = none. */
  error: string
  busy: boolean
  load: () => Promise<void>
  check: () => Promise<void>
  setConfig: (c: { auto?: boolean; channel?: UpdateChannel; feedUrl?: string }) => Promise<boolean>
}

export const useUpdateStore = create<UpdateUiState>((set) => ({
  state: initialUpdateState(''), loaded: false, error: '', busy: false,
  load: async () => {
    const a = bridge()?.updates
    if (!a) { set({ loaded: true }); return }
    try { const r = await a.state(); if (r.ok) set({ state: r.data, loaded: true }); else set({ loaded: true }) } catch { set({ loaded: true }) }
  },
  check: async () => {
    const a = bridge()?.updates
    if (!a) return
    set({ busy: true, error: '' })
    try {
      const r = await a.check()
      if (r.ok) set({ state: r.data, busy: false }); else set({ error: r.error.message, busy: false })
    } catch { set({ error: 'Could not check for updates. Try again.', busy: false }) }
  },
  setConfig: async (c) => {
    const a = bridge()?.updates
    if (!a) return false
    set({ error: '' })
    try {
      const r = await a.setConfig(c)
      if (r.ok) { set({ state: r.data }); return true }
      set({ error: r.error.message })
    } catch { set({ error: 'Could not save. Try again.' }) }
    return false
  }
}))

/**
 * Restart and install. The unsaved-changes guard runs first (Save / Discard / Cancel); main refuses the install again if an
 * unsaved bill is still open, so a stale renderer can never cause a restart under a dirty bill.
 */
export function restartToUpdate(): void {
  requestLeave(() => {
    const a = bridge()?.updates
    if (!a) return
    void a.setBusy(false)
      .then(() => a.install())
      .then((r) => { if (!r.ok) useUpdateStore.setState({ error: r.error.message }) })
      .catch(() => useUpdateStore.setState({ error: 'Could not restart to update. Try again.' }))
  })
}

/** AppShell hook: loads the state, follows `updates:state`, and tells main whether an unsaved bill is open. */
export function startUpdates(): () => void {
  const b = bridge()
  const api = b?.updates
  if (!api) return () => undefined
  let last: boolean | undefined
  const report = (): void => {
    const s = useBillStore.getState()
    const busy = s.billId !== null && s.dirty
    if (busy === last) return
    last = busy
    void api.setBusy(busy).catch(() => undefined)
  }
  report()
  const unStore = useBillStore.subscribe(report)
  const unEvent = b?.on?.('updates:state', (p: unknown) => { if (p && typeof p === 'object') useUpdateStore.setState({ state: p as UpdateState }) })
  void useUpdateStore.getState().load()
  return () => { unStore(); unEvent?.() }
}
