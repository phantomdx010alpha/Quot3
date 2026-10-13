import { House, PlusCircle, ClockCounterClockwise, UsersThree, ListMagnifyingGlass, GearSix, type Icon as PhosphorIcon } from '@phosphor-icons/react'
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
  { path: ROUTES.settings, label: 'Settings', action: 'nav.settings', icon: GearSix }
]
