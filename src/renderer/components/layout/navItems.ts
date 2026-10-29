import { House, PlusCircle, ClockCounterClockwise, UsersThree, ListMagnifyingGlass, GameController, GearSix, type Icon as PhosphorIcon } from '@phosphor-icons/react'
import { ROUTES, type RoutePath } from '@shared/routes'
import type { ActionId } from '@shared/shortcuts'

export interface NavItem {
  path: RoutePath
  label: string
  action: ActionId
  icon: PhosphorIcon
}

/** Side-rail / dashboard entries. Key bindings come from the shortcut registry via `action`. */
export const NAV_ITEMS: readonly NavItem[] = [
  { path: ROUTES.dashboard, label: 'Dashboard', action: 'nav.dashboard', icon: House },
  { path: ROUTES.create, label: 'Create', action: 'nav.create', icon: PlusCircle },
  { path: ROUTES.history, label: 'History', action: 'nav.history', icon: ClockCounterClockwise },
  { path: ROUTES.customers, label: 'Customers', action: 'nav.customers', icon: UsersThree },
  { path: ROUTES.items, label: 'Items', action: 'nav.items', icon: ListMagnifyingGlass },
  // Phase 202 (M19): shown only while `games.enabled` is on (see `visibleNavItems`).
  { path: ROUTES.games, label: 'Games', action: 'nav.games', icon: GameController },
  { path: ROUTES.settings, label: 'Settings', action: 'nav.settings', icon: GearSix }
]

/** The rail entries to show: Games only while the setting is on. Pure. */
export function visibleNavItems(items: readonly NavItem[], gamesEnabled: boolean): NavItem[] {
  return items.filter((i) => i.path !== ROUTES.games || gamesEnabled)
}
