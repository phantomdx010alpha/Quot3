import type { Quot3Bridge } from '@shared/ipc'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_THEME_ID } from '@shared/theme/tokens'
import type { ThemeFile } from '@shared/theme/validateTheme'
import type { ThemeLoadError } from '@shared/ipc'
import { themeInlineTokens } from '@shared/theme/applyV2'
import { initEffects, setThemeEffects } from './effects'
import { initScenes, setThemeBackground } from './scenes/sceneState'
import { reapplyUiPrefs, useUiPrefsStore } from '../stores/uiPrefsStore'

export interface ThemeContextValue {
  themes: ThemeFile[]
  errors: ThemeLoadError[]
  activeId: string
  setActive(id: string): Promise<void>
  reload(): Promise<void>
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/** Tokens we have set inline, so a theme switch can remove them cleanly. */
let appliedTokens: string[] = []

/**
 * Applies a theme to <html>: built-ins are selected by data-theme (rules live in tokens.css);
 * custom themes select their built-in `base` and override whitelisted, already-sanitised tokens
 * through CSSOM setProperty (never string-built CSS).
 */
export function applyTheme(theme: ThemeFile): void {
  const el = document.documentElement
  for (const name of appliedTokens) el.style.removeProperty(name)
  appliedTokens = []
  el.setAttribute('data-theme', theme.builtin ? theme.id : (theme.base ?? DEFAULT_THEME_ID))
  // Phase 166: schema-2 gradients / fonts / shape become tokens first; the theme's own explicit tokens win over them.
  for (const [name, value] of Object.entries(themeInlineTokens(theme))) {
    el.style.setProperty(name, value)
    appliedTokens.push(name)
  }
  // Phase 167: animation presets (attributes on <html>; none for built-ins and v1 themes)
  setThemeEffects(theme.v2?.effects)
  // Phase 169: built-in 3D scene picked by name (none for built-ins and v1 themes)
  setThemeBackground(theme.v2?.background)
}

/** Phase 166: a theme that cannot be applied never breaks the look - everything it set is removed and the base built-in is shown. */
export function applyThemeSafe(theme: ThemeFile): boolean {
  try {
    applyTheme(theme)
    return true
  } catch {
    try {
      applyTheme({ id: theme.base ?? DEFAULT_THEME_ID, name: '', tokens: {}, builtin: true })
    } catch { /* leave the page as it is */ }
    return false
  }
}

/** Phase 98: tell main the title bar colours the theme now has, so the native button strip matches (main ignores unusable values; Windows only). */
export function syncTitleBar(): void {
  try {
    const cs = getComputedStyle(document.documentElement)
    const get = (n: string): string => cs.getPropertyValue(n).trim()
    const send = (window as unknown as { quot3?: { themes?: { setTitleBar?: (i: { bg: string; symbol: string; height: string }) => Promise<unknown> } } }).quot3?.themes?.setTitleBar
    if (!send) return
    void send({ bg: get('--titlebar-bg'), symbol: get('--titlebar-symbol'), height: get('--titlebar-height') || '32px' }).catch(() => undefined)
  } catch { /* cosmetic only */ }
}

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [themes, setThemes] = useState<ThemeFile[]>([])
  const [errors, setErrors] = useState<ThemeLoadError[]>([])
  const [activeId, setActiveId] = useState(DEFAULT_THEME_ID)

  const apply = useCallback((list: ThemeFile[], id: string) => {
    const t = list.find((x) => x.id === id) ?? list.find((x) => x.id === DEFAULT_THEME_ID)
    if (t) {
      applyThemeSafe(t)
      syncTitleBar()
      reapplyUiPrefs() // Phase 49: density / font-size preferences sit on top of the theme
    }
  }, [])

  useEffect(() => {
    let live = true
    initEffects()
    initScenes()
    void (async () => {
      const [list, active] = await Promise.all([window.quot3.themes.list(), window.quot3.themes.getActive()])
      if (!live || !list.ok) return
      const id = active.ok ? active.data.id : DEFAULT_THEME_ID
      setThemes(list.data.themes)
      setErrors(list.data.errors)
      setActiveId(id)
      apply(list.data.themes, id)
      void useUiPrefsStore.getState().load()
    })()
    return () => {
      live = false
    }
  }, [apply])

  const setActive = useCallback(
    async (id: string) => {
      const res = await window.quot3.themes.setActive(id)
      if (!res.ok) return
      setActiveId(res.data.id)
      apply(themes, res.data.id)
    },
    [apply, themes]
  )

  const reload = useCallback(async () => {
    const res = await window.quot3.themes.reload()
    if (!res.ok) return
    setThemes(res.data.themes)
    setErrors(res.data.errors)
    // The active custom theme may have been edited or removed: re-resolve it.
    const active = await window.quot3.themes.getActive()
    const id = active.ok ? active.data.id : DEFAULT_THEME_ID
    setActiveId(id)
    apply(res.data.themes, id)
  }, [apply])

  // Phase 171: a shared theme arrived (or was removed) on this PC: re-read the list.
  useEffect(() => {
    const unsub = (window as unknown as { quot3?: Partial<Quot3Bridge> }).quot3?.on?.('themes:changed', () => { void reload() })
    return () => { unsub?.() }
  }, [reload])

  const value = useMemo(() => ({ themes, errors, activeId, setActive, reload }), [themes, errors, activeId, setActive, reload])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
