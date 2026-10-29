/** Route table and the pure history-stack logic behind the in-memory router (Phase 4). No DOM, no Electron. */

export const ROUTES = {
  dashboard: '/',
  create: '/create',
  history: '/history',
  customers: '/customers',
  items: '/items',
  /** Phase 202 (M19): the Games page (shown only while the setting `games.enabled` is on). */
  games: '/games',
  settings: '/settings',
  designPreview: '/dev/design-preview',
  devGrid: '/dev/grid',
  devPerf: '/dev/perf',
  devPrintPreview: '/dev/print-preview'
} as const

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES]

/** Phase 94: with the Dashboard-rooted model the stack is at most [dashboard, page, bill] deep; the cap is a safety net. */
export const NAV_STACK_MAX = 3

/** Pages a bill can be opened from, and so Esc returns to (Phase 94). */
const RETURN_PAGES: readonly string[] = [ROUTES.history, ROUTES.customers, ROUTES.items]

export function isRoutePath(p: string): p is RoutePath {
  return (Object.values(ROUTES) as string[]).includes(p)
}

export interface NavState {
  /** Oldest first; the last entry is the current page; entry 0 is always the Dashboard. Never empty. */
  stack: string[]
}

export function initialNav(path: string = ROUTES.dashboard): NavState {
  return { stack: isRoutePath(path) && path !== ROUTES.dashboard ? [ROUTES.dashboard, path] : [ROUTES.dashboard] }
}

export function currentPath(s: NavState): string {
  return s.stack[s.stack.length - 1] ?? ROUTES.dashboard
}

export function canGoBack(s: NavState): boolean {
  return s.stack.length > 1
}

export interface NavPushOptions {
  /** The page is a drill-down opened from the current History / Customers / Items page (a bill): Esc returns there. */
  returnToCurrent?: boolean
}

/**
 * Phase 94: Dashboard is the root. Navigating anywhere resets the stack to [dashboard, page] so Esc is one step to the Dashboard
 * and never walks a long history. The one exception is a drill-down (`returnToCurrent`) from History / Customers, which keeps
 * that page underneath: [dashboard, history, create]. Unknown paths and navigating to the current page are no-ops.
 */
export function navPush(s: NavState, path: string, opts: NavPushOptions = {}): NavState {
  if (!isRoutePath(path) || path === currentPath(s)) return s
  if (path === ROUTES.dashboard) return { stack: [ROUTES.dashboard] }
  const cur = currentPath(s)
  if (opts.returnToCurrent && RETURN_PAGES.includes(cur)) return { stack: [ROUTES.dashboard, cur, path] }
  return { stack: [ROUTES.dashboard, path] }
}

/** Pop one page; at the Dashboard (the root) it is a no-op. */
export function navBack(s: NavState): NavState {
  return canGoBack(s) ? { stack: s.stack.slice(0, -1) } : s
}
