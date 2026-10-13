import { create } from 'zustand'
import type { FormatKind } from '@shared/richtext/format'

/** Phase 11: the grid's visible edit-mode indicator (status line). Written by the grid controller, read by GridStatus. */
interface GridUiState {
  mode: 'idle' | 'append' | 'free'
  /** First Left press seen in Append — one more unlocks Free (KB D-K1). */
  armed: boolean
  set: (mode: GridUiState['mode'], armed: boolean) => void
  /** Phase 13: registered by the mounted grid controller so the palette action can reset the active Total. */
  resetTotal: (() => void) | null
  /** Phase 15: registered by the mounted controller. Formats the active item-name cell (selection → else whole cell). */
  format: ((kind: FormatKind, sel?: { start: number; end: number }) => boolean) | null
  /** Phase 15: open the compact format palette at the active cell (Ctrl+Shift+K). */
  openFormatPalette: (() => void) | null
  /** Phase 15: put focus + selection back on the active cell (after the palette / toolbar). */
  refocus: (() => void) | null
  /** Phase 15: format palette state (position + the selection captured when it opened). */
  formatPalette: { x: number; y: number; start: number; end: number } | null
  setFormatPalette: (p: GridUiState['formatPalette']) => void
  /** Phase 16: one-line status message (paste report etc.). Cleared by the controller on the next key. */
  notice: string
  setNotice: (text: string) => void
  /** Phase 16: registered by the mounted controller; palette actions use them (copy/cut via execCommand, paste via clipboard:readGrid). */
  copy: (() => void) | null
  cut: (() => void) | null
  paste: (() => void) | null
  /** Phase 122: registered by the mounted controller (palette / shortcut actions): select the active row, delete the selected rows. */
  selectRow: (() => void) | null
  deleteRows: (() => void) | null
  /** Phase 124: move the active item row (shortcut / palette). */
  moveRow: ((target: 'up' | 'down' | 'top' | 'bottom') => void) | null
  /** Phase 80: UI-only minimum number of tail rows shown (Enter on the last tail row grows it). Never saved; the grid resets it per bill. */
  tailShown: number
  setTailShown: (n: number) => void
}
export const useGridUiStore = create<GridUiState>((set, get) => ({
  mode: 'idle',
  armed: false,
  resetTotal: null,
  format: null,
  openFormatPalette: null,
  refocus: null,
  formatPalette: null,
  setFormatPalette: (p) => set({ formatPalette: p }),
  notice: '',
  setNotice: (text) => { if (get().notice !== text) set({ notice: text }) },
  copy: null,
  cut: null,
  paste: null,
  selectRow: null,
  deleteRows: null,
  moveRow: null,
  tailShown: 0,
  setTailShown: (n) => { if (get().tailShown !== n) set({ tailShown: n }) },
  set: (mode, armed) => {
    const s = get()
    if (s.mode !== mode || s.armed !== armed) set({ mode, armed })
  }
}))
