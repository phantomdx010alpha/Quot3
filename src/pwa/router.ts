/** Tiny in-memory router for the phone shell (Phase 174). Pure: no DOM, no history API (an installed app has no URL bar).
 *  Later phases add route names here; the stack never goes behind the first entry. */
export type RouteName = 'home' | 'history' | 'create' | 'customers' | 'settings' | 'about' | 'billview' | 'trash' | 'customer'

/** The five bottom-navigation destinations (Phase 180). `home` is the Dashboard and the root: Back never goes behind it. */
export const TAB_ROUTES = ['home', 'history', 'create', 'customers', 'settings'] as const satisfies readonly RouteName[]
export type TabRoute = (typeof TAB_ROUTES)[number]

export function isTabRoute(name: RouteName): name is TabRoute {
  return (TAB_ROUTES as readonly string[]).includes(name)
}

export interface Route {
  readonly name: RouteName
  /** The record a page shows: the bill id for `billview` and for `create` (Edit). Absent for the plain pages. */
  readonly param?: string
}

export interface RouterState {
  readonly stack: readonly Route[]
}

export function createRouter(initial: RouteName = 'home'): RouterState {
  return { stack: [{ name: initial }] }
}

export function currentRoute(state: RouterState): Route {
  return state.stack[state.stack.length - 1] ?? { name: 'home' }
}

export function navigate(state: RouterState, name: RouteName, param?: string): RouterState {
  const cur = currentRoute(state)
  if (cur.name === name && cur.param === param) return state
  return { stack: [...state.stack, param === undefined ? { name } : { name, param }] }
}

export function canGoBack(state: RouterState): boolean {
  return state.stack.length > 1
}

export function goBack(state: RouterState): RouterState {
  return canGoBack(state) ? { stack: state.stack.slice(0, -1) } : state
}

/** Bottom-navigation tap. The Dashboard is the root, so every other tab sits one step above it: Back from any tab goes to the Dashboard,
 *  and Back from the Dashboard goes nowhere (the system Back then leaves the app). Tapping the current tab changes nothing. */
export function navigateTab(state: RouterState, tab: TabRoute): RouterState {
  if (currentRoute(state).name === tab) return state
  return tab === 'home' ? { stack: [{ name: 'home' }] } : { stack: [{ name: 'home' }, { name: tab }] }
}

/** The tab to highlight: the nearest tab at or below the top of the stack (a pushed page such as About keeps its parent tab lit). */
export function activeTab(state: RouterState): TabRoute {
  for (let i = state.stack.length - 1; i >= 0; i--) {
    const r = state.stack[i]
    if (r && isTabRoute(r.name)) return r.name
  }
  return 'home'
}
