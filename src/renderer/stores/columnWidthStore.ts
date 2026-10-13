import { create } from 'zustand'
import { COL_WIDTHS_SETTING_KEY, resetColWidth, resetFormatColWidths, sanitizeColWidths, setColWidth, type ColWidthOverrides } from '@shared/columnWidths'

/**
 * Phase 23 — per-format column width overrides. Display-only (not part of the bill, not undoable). Loaded once from the
 * `grid.colWidths` setting and saved debounced, off the drag path; with no bridge (tests, design preview) it is in-memory only.
 */
interface ColWidthState {
  overrides: ColWidthOverrides
  loaded: boolean
  load: () => Promise<void>
  set: (formatId: string, key: string, px: number) => void
  reset: (formatId: string, key: string) => void
  resetAll: (formatId: string) => void
}
let timer: ReturnType<typeof setTimeout> | null = null
function persist(o: ColWidthOverrides): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { void window.quot3?.settings?.set(COL_WIDTHS_SETTING_KEY, o).catch?.(() => undefined) }, 400)
}
export const useColWidthStore = create<ColWidthState>((set, get) => ({
  overrides: {},
  loaded: false,
  load: async () => {
    if (get().loaded) return
    set({ loaded: true })
    try {
      const res = await window.quot3?.settings?.get(COL_WIDTHS_SETTING_KEY)
      if (res && res.ok) set({ overrides: sanitizeColWidths((res.data as { value: unknown }).value) })
    } catch { /* keep defaults */ }
  },
  set: (f, k, px) => { const o = setColWidth(get().overrides, f, k, px); set({ overrides: o }); persist(o) },
  reset: (f, k) => { const o = resetColWidth(get().overrides, f, k); if (o !== get().overrides) { set({ overrides: o }); persist(o) } },
  resetAll: (f) => { const o = resetFormatColWidths(get().overrides, f); if (o !== get().overrides) { set({ overrides: o }); persist(o) } }
}))
