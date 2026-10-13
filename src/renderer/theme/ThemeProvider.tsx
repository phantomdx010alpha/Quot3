import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_THEME_ID } from '@shared/theme/tokens'
import type { ThemeFile } from '@shared/theme/validateTheme'
import type { ThemeLoadError } from '@shared/ipc'
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
  for (const [name, value] of Object.entries(theme.tokens)) {
    el.style.setProperty(name, value)
    appliedTokens.push(name)
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
      applyTheme(t)
      syncTitleBar()
      reapplyUiPrefs() // Phase 49: density / font-size preferences sit on top of the theme
    }
  }, [])

  useEffect(() => {
    let live = true
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

  const value = useMemo(() => ({ themes, errors, activeId, setActive, reload }), [themes, errors, activeId, setActive, reload])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
