import { ClockCounterClockwise, Gear, House, PlusCircle, Users, type Icon } from '@phosphor-icons/react'
import type { ReactElement } from 'react'
import { TAB_ROUTES, type TabRoute } from '../router'

const ITEMS: Record<TabRoute, { label: string; Icon: Icon }> = {
  home: { label: 'Home', Icon: House },
  history: { label: 'History', Icon: ClockCounterClockwise },
  create: { label: 'New', Icon: PlusCircle },
  customers: { label: 'Customers', Icon: Users },
  settings: { label: 'Settings', Icon: Gear }
}

/** Bottom navigation (Phase 180): five tabs, 40 px minimum touch height, bold icon on the active tab, safe-area padding from the shell. */
export function BottomNav(props: { active: TabRoute; onSelect: (tab: TabRoute) => void }): ReactElement {
  return (
    <nav className="q3-nav" aria-label="Main">
      {TAB_ROUTES.map((tab) => {
        const { label, Icon } = ITEMS[tab]
        const on = props.active === tab
        return (
          <button key={tab} type="button" className={`q3-nav-item${on ? ' is-active' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => props.onSelect(tab)}>
            <Icon size={22} weight={on ? 'bold' : 'light'} aria-hidden="true" />
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
