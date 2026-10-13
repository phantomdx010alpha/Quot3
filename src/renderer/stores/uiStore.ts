import { create } from 'zustand'

/** Transient UI state shared across the shell (overlays). Not persisted. */
interface UiState {
  paletteOpen: boolean
  sheetOpen: boolean
  openPalette: () => void
  closePalette: () => void
  togglePalette: () => void
  openSheet: () => void
  closeSheet: () => void
}

export const useUiStore = create<UiState>((set) => ({
  paletteOpen: false,
  sheetOpen: false,
  // Only one overlay at a time.
  openPalette: () => set({ paletteOpen: true, sheetOpen: false }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen, sheetOpen: false })),
  openSheet: () => set({ sheetOpen: true, paletteOpen: false }),
  closeSheet: () => set({ sheetOpen: false })
}))
