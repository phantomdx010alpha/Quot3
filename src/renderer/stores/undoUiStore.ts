import { create } from 'zustand'

/** Phase 18: transient UI state for the undo panel and the revert confirmation. Not undoable, not persisted. */
interface UndoUiState {
  panelOpen: boolean
  revertOpen: boolean
  openPanel: () => void
  closePanel: () => void
  togglePanel: () => void
  openRevert: () => void
  closeRevert: () => void
}
export const useUndoUiStore = create<UndoUiState>((set) => ({
  panelOpen: false,
  revertOpen: false,
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  openRevert: () => set({ revertOpen: true }),
  closeRevert: () => set({ revertOpen: false })
}))
