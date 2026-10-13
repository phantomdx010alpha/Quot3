import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import { DEFAULT_UI_PREFS, UI_PREF_KEYS, readUiPrefs, uiPrefTokens, validateUiPrefs, type UiPrefs } from '@shared/settings/uiPrefs'

/**
 * Phase 49 - density and font-size preferences. Applied as inline tokens on <html> AFTER the theme (so the theme's own value
 * is the fallback and `null` simply removes the override). Stored through the generic `settings` bridge.
 */
type Api = Quot3Bridge['settings']
const api = (): Api | undefined => (window as unknown as { quot3?: { settings?: Api } }).quot3?.settings

let applied: string[] = []

/** Sets (or clears) the preference tokens on <html>. Safe to call as often as needed. */
export function applyUiPrefs(p: UiPrefs): void {
  const el = document.documentElement
  for (const name of applied) el.style.removeProperty(name)
  applied = []
  for (const [name, value] of Object.entries(uiPrefTokens(p))) {
    el.style.setProperty(name, value)
    applied.push(name)
  }
}

export interface UiPrefsState {
  prefs: UiPrefs
  error: string
  load: () => Promise<void>
  save: (input: { rowHeight: unknown; gridFontSize: unknown }) => Promise<boolean>
  reset: () => Promise<boolean>
}

export const useUiPrefsStore = create<UiPrefsState>((set, get) => {
  async function persist(p: UiPrefs): Promise<boolean> {
    const a = api()
    if (!a) { set({ error: 'Preferences are not available (no connection to the app).' }); return false }
    try {
      const r1 = await a.set(UI_PREF_KEYS.rowHeight, p.rowHeight)
      const r2 = await a.set(UI_PREF_KEYS.gridFontSize, p.gridFontSize)
      if (!r1.ok || !r2.ok) { set({ error: (!r1.ok ? r1.error.message : !r2.ok ? r2.error.message : '') || 'Could not save.' }); return false }
    } catch {
      set({ error: 'Could not save. Try again.' })
      return false
    }
    set({ prefs: p, error: '' })
    applyUiPrefs(p)
    return true
  }
  return {
    prefs: DEFAULT_UI_PREFS,
    error: '',
    load: async () => {
      const a = api()
      if (!a) return
      try {
        const [h, f] = await Promise.all([a.get(UI_PREF_KEYS.rowHeight), a.get(UI_PREF_KEYS.gridFontSize)])
        const p = readUiPrefs({ rowHeight: h.ok ? h.data.value : null, gridFontSize: f.ok ? f.data.value : null })
        set({ prefs: p })
        applyUiPrefs(p)
      } catch { /* the theme's own values stay */ }
    },
    save: async (input) => {
      const v = validateUiPrefs(input)
      if (!v.ok) { set({ error: v.message }); return false }
      return persist(v.value)
    },
    reset: () => persist(DEFAULT_UI_PREFS)
  }
})

/** Re-applies the saved preferences (called after every theme change, which clears inline theme tokens). */
export const reapplyUiPrefs = (): void => applyUiPrefs(useUiPrefsStore.getState().prefs)
