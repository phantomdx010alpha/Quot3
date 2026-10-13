import { create } from 'zustand'

/** Phase 21: transient UI state for extra-column management — which header is being renamed and which removal awaits confirmation. Not undoable, not persisted. */
interface ExtraColUiState {
  renameKey: string | null
  removeKey: string | null
  startRename: (key: string) => void
  endRename: () => void
  askRemove: (key: string) => void
  closeRemove: () => void
  /** Phase 22: which units popup is open. */
  units: 'units' | 'marked' | null
  openUnits: (v: 'units' | 'marked') => void
  closeUnits: () => void
}
export const useExtraColUiStore = create<ExtraColUiState>((set) => ({
  renameKey: null,
  removeKey: null,
  startRename: (key) => set({ renameKey: key }),
  endRename: () => set({ renameKey: null }),
  askRemove: (key) => set({ removeKey: key }),
  closeRemove: () => set({ removeKey: null }),
  units: null,
  openUnits: (v) => set({ units: v }),
  closeUnits: () => set({ units: null })
}))
