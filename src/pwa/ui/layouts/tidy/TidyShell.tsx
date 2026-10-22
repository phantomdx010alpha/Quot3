import { ArrowLeft, ClockCounterClockwise, Gear, House, Plus, Users, type Icon } from '@phosphor-icons/react'
import type { ReactElement } from 'react'
import type { TabRoute } from '../../../router'
import { StatusPill } from '../../kit/StatusPill'
import type { ShellProps } from '../types'
import '../../kit/kit.css'
import '../layouts.css'
import './tidy.css'

/** Tidy tabs nav (Phase 192): Home, Bills, a raised round New in the centre, Customers, Settings. Mapped onto the existing route names. */
export const TIDY_TABS: readonly { route: TabRoute; label: string; Icon: Icon }[] = [
  { route: 'home', label: 'Home', Icon: House },
  { route: 'history', label: 'Bills', Icon: ClockCounterClockwise },
  { route: 'create', label: 'New bill', Icon: Plus },
  { route: 'customers', label: 'Customers', Icon: Users },
  { route: 'settings', label: 'Settings', Icon: Gear }
]

/** The Tidy shell: a bar with Back and the title, the status pill (instead of stacked banners), the page, and the five-tab nav. The nav is hidden in the editor.
 *  The unsaved-bill guard stays in App.tsx: Back and the tabs only call what App gave. */
export function TidyShell(props: ShellProps): ReactElement {
  const editing = props.route === 'create'
  return (
    <div className="q3-shell q3x-tidy">
      <header className="q3x-tidy-bar">
        {props.canGoBack ? (
          <button type="button" className="q3x-tidy-back" onClick={props.onBack} aria-label="Back"><ArrowLeft size={22} weight="bold" aria-hidden="true" /></button>
        ) : null}
        <h1 className="q3x-tidy-title">{props.title ?? 'Quot3'}</h1>
      </header>
      {props.status ? <StatusPill flags={props.status} onAction={props.onStatusAction} /> : null}
      <main className="q3-main q3x-tidy-main">{props.children}</main>
      {editing ? null : (
        <nav className="q3x-tidy-nav" aria-label="Main">
          {TIDY_TABS.map(({ route, label, Icon }) => {
            const on = props.activeTab === route
            if (route === 'create') {
              return (
                <div key={route} className="q3x-tidy-newwrap">
                  <button type="button" className="q3x-tidy-new" aria-label="New bill" onClick={() => props.onSelectTab('create')}><Icon size={28} weight="bold" aria-hidden="true" /></button>
                </div>
              )
            }
            return (
              <button key={route} type="button" className="q3x-tidy-tab" aria-current={on ? 'page' : undefined} onClick={() => props.onSelectTab(route)}>
                <Icon size={24} weight={on ? 'bold' : 'light'} aria-hidden="true" />
                <span className="q3x-tidy-tab-text">{label}</span>
              </button>
            )
          })}
        </nav>
      )}
    </div>
  )
}
