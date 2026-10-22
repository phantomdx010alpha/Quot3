import type { RouteName } from '../../router'
import { classicLayout } from './classic'
import { guidedLayout } from './guided/guidedLayout'
import { inboxLayout } from './inbox/inboxLayout'
import { tidyLayout } from './tidy/tidyLayout'
import type { LayoutDefinition } from './types'

/** Phase 189: the phone layouts. `classic` is today's screen (default, locked by `classicParity.test.ts`); the others are built by Phases 192-194. */
export const LAYOUT_IDS = ['classic', 'tidy', 'guided', 'inbox'] as const
export type LayoutId = (typeof LAYOUT_IDS)[number]
export const DEFAULT_LAYOUT: LayoutId = 'classic'

export const isLayoutId = (v: unknown): v is LayoutId => typeof v === 'string' && (LAYOUT_IDS as readonly string[]).includes(v)

export const LAYOUT_LABELS: Record<LayoutId, string> = {
  classic: 'Classic',
  tidy: 'Tidy tabs',
  guided: 'Guided flow',
  inbox: 'Bills inbox'
}

export const LAYOUT_BLURBS: Record<LayoutId, string> = {
  classic: 'Today\u2019s screen, exactly as it is now.',
  tidy: 'Bigger text, tabs for party, items and totals.',
  guided: 'One step at a time: party, items, review.',
  inbox: 'Your bills first, like an inbox.'
}

/** The layouts that are BUILT. The Settings chooser lists exactly these, so an unbuilt layout is never offered. Each layout phase adds its entry. */
export const LAYOUTS: Partial<Record<LayoutId, LayoutDefinition>> = {
  classic: classicLayout,
  tidy: tidyLayout,
  guided: guidedLayout,
  inbox: inboxLayout
}

export const builtLayoutIds = (): LayoutId[] => LAYOUT_IDS.filter((id) => LAYOUTS[id] !== undefined)

/** What the app uses for a stored / passed value: only a known AND built layout counts; anything else (unknown text after a downgrade, a layout not built yet) is classic. */
export function resolveLayout(v: unknown): LayoutId {
  return isLayoutId(v) && LAYOUTS[v] !== undefined ? v : DEFAULT_LAYOUT
}

/** Does the layout have a page for this route? Classic has all of them; a new layout only the ones it built (so a switch goes Home when the page is missing). */
export function layoutHasRoute(layout: LayoutId, route: RouteName): boolean {
  const def = LAYOUTS[layout]
  if (!def) return false
  if (def.id === 'classic') return true
  return route === 'home' || route === 'create' || def.screens[route] !== undefined || def.reusesClassic?.includes(route) === true
}

export interface LayoutChangePlan {
  /** none = nothing to do; hold = a bill is unsaved, ask first (the app's Save / Discard / Keep editing prompt); apply = switch now. */
  action: 'none' | 'hold' | 'apply'
  layout: LayoutId
  /** Keep the current page in the new layout (true) or go Home (false). */
  keepRoute: boolean
}

/** Pure decision for a layout change (contract M18-1). It never touches data: the caller saves the setting only. */
export function planLayoutChange(input: { current: LayoutId; next: unknown; hasUnsaved: boolean; route: RouteName }): LayoutChangePlan {
  const next = resolveLayout(input.next)
  if (next === input.current) return { action: 'none', layout: input.current, keepRoute: true }
  return { action: input.hasUnsaved ? 'hold' : 'apply', layout: next, keepRoute: layoutHasRoute(next, input.route) }
}
