import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import { CALC_PREF_KEYS, DEFAULT_CALC_PREFS, otherMode, readCalcPrefs, type CalcMode } from '@shared/calc/calcPanel'

/**
 * Phase 83 - the calculator drawer's state: open / mode (persisted through the generic `settings` bridge as `calc.open` /
 * `calc.mode`) and the typed text (kept while the drawer is closed, never saved). Not part of the bill: nothing here is undoable
 * and nothing here marks the bill dirty.
 */
type Api = Quot3Bridge['settings']
const api = (): Api | undefined => (window as unknown as { quot3?: { settings?: Api } }).quot3?.settings

export interface CalcPanelState {
  open: boolean
  mode: CalcMode
  expr: string
  typedPercent: string
  /** Bumped on every open / mode switch so the drawer re-focuses its field. */
  focusTick: number
  load: () => Promise<void>
  setOpen: (open: boolean) => void
  toggle: () => void
  setMode: (m: CalcMode) => void
  switchMode: () => void
  setExpr: (t: string) => void
  setTypedPercent: (t: string) => void
}

function persist(key: string, value: unknown): void {
  const a = api()
  if (!a) return
  try { void a.set(key, value).catch(() => undefined) } catch { /* a preference that fails to save is not worth a message */ }
}

export const useCalcPanelStore = create<CalcPanelState>((set, get) => ({
  ...DEFAULT_CALC_PREFS,
  expr: '',
  typedPercent: '',
  focusTick: 0,
  load: async () => {
    const a = api()
    if (!a) return
    try {
      const [o, m] = await Promise.all([a.get(CALC_PREF_KEYS.open), a.get(CALC_PREF_KEYS.mode)])
      const p = readCalcPrefs({ open: o.ok ? o.data.value : null, mode: m.ok ? m.data.value : null })
      set({ open: p.open, mode: p.mode })
    } catch { /* closed + calculator stay */ }
  },
  setOpen: (open) => {
    if (get().open === open) return
    set({ open, focusTick: get().focusTick + 1 })
    persist(CALC_PREF_KEYS.open, open)
  },
  toggle: () => get().setOpen(!get().open),
  setMode: (mode) => {
    if (get().mode === mode) { set({ focusTick: get().focusTick + 1 }); return }
    set({ mode, focusTick: get().focusTick + 1 })
    persist(CALC_PREF_KEYS.mode, mode)
  },
  switchMode: () => {
    // Switching mode from the key also opens a closed drawer, so the key always shows something.
    const s = get()
    if (!s.open) { set({ open: true }); persist(CALC_PREF_KEYS.open, true) }
    s.setMode(otherMode(get().mode))
  },
  setExpr: (expr) => set({ expr }),
  setTypedPercent: (typedPercent) => set({ typedPercent })
}))
