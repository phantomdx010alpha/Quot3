import { create } from 'zustand'

/** Phase 27 — what the last save did, so `SaveFlow` (mounted on Create) can show a toast. `seq` makes every save a new event. */
export interface SaveEvent {
  seq: number
  tone: 'ok' | 'warn' | 'danger'
  message: string
}

interface SaveUiState {
  saving: boolean
  last: SaveEvent | null
  /** Phase 116: the latest routine ("ok") confirmation, shown as quiet text in the bottom bar instead of a toast. */
  quiet: SaveEvent | null
  /** Phase 116: how many quiet status lines are mounted; with none, an "ok" notice still falls back to a toast. */
  quietHosts: number
  addQuietHost: (delta: 1 | -1) => void
  setSaving: (saving: boolean) => void
  announce: (tone: SaveEvent['tone'], message: string) => void
}

let seq = 0
export const useSaveUiStore = create<SaveUiState>((set) => ({
  saving: false,
  last: null,
  quiet: null,
  quietHosts: 0,
  addQuietHost: (delta) => set((s) => ({ quietHosts: Math.max(0, s.quietHosts + delta) })),
  setSaving: (saving) => set({ saving }),
  announce: (tone, message) => set((s) => {
    const ev = { seq: ++seq, tone, message }
    return tone === 'ok' ? { last: ev, quiet: ev } : { last: ev }
  })
}))
