import { create } from 'zustand'
import { ROUTES, canGoBack, currentPath, initialNav, isRoutePath, navBack, navPush, type NavPushOptions, type NavState } from '@shared/routes'

interface RouterState {
  nav: NavState
  /** Monotonic counter bumped on every successful navigation; the shell uses it to move focus to the new page. */
  navCount: number
  navigate: (path: string, opts?: NavPushOptions) => void
  back: () => void
}

function pathFromHash(): string {
  const h = window.location.hash.replace(/^#/, '')
  return isRoutePath(h) ? h : ROUTES.dashboard
}

/** Phase 28: leaving the Create page asks this first (it calls `proceed` now or after the owner answers). */
let leaveGuard: ((proceed: () => void) => boolean) | null = null
export function setLeaveGuard(g: ((proceed: () => void) => boolean) | null): void { leaveGuard = g }

/** Tiny in-memory router (no URL bar in Electron). A `#/dev/...` hash only seeds the first page. */
export const useRouter = create<RouterState>((set, get) => ({
  nav: initialNav(pathFromHash()),
  navCount: 0,
  navigate: (path, opts) => {
    const go = (): void => {
      const next = navPush(get().nav, path, opts)
      if (next !== get().nav) set((s) => ({ nav: next, navCount: s.navCount + 1 }))
    }
    if (leaveGuard && currentPath(get().nav) === ROUTES.create && path !== ROUTES.create) leaveGuard(go)
    else go()
  },
  back: () => {
    const go = (): void => {
      const next = navBack(get().nav)
      if (next !== get().nav) set((s) => ({ nav: next, navCount: s.navCount + 1 }))
    }
    const target = navBack(get().nav)
    if (leaveGuard && target !== get().nav && currentPath(get().nav) === ROUTES.create && currentPath(target) !== ROUTES.create) leaveGuard(go)
    else go()
  }
}))

export const usePath = (): string => useRouter((s) => currentPath(s.nav))
export const useCanGoBack = (): boolean => useRouter((s) => canGoBack(s.nav))
