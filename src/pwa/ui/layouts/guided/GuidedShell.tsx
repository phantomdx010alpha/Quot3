import { ArrowLeft, ClockCounterClockwise, DotsThree, House, Users, type Icon } from '@phosphor-icons/react'
import type { ReactElement } from 'react'
import type { TabRoute } from '../../../router'
import { StatusPill } from '../../kit/StatusPill'
import type { ShellProps } from '../types'
import '../../kit/kit.css'
import '../layouts.css'
import '../tidy/tidy.css'
import './guided.css'

/** Guided flow nav (Phase 193): Home, Bills (= history), Customers, More (= settings). New bill is the big button on Home. */
export const GUIDED_TABS: readonly { route: TabRoute; label: string; Icon: Icon }[] = [
  { route: 'home', label: 'Home', Icon: House },
  { route: 'history', label: 'Bills', Icon: ClockCounterClockwise },
  { route: 'customers', label: 'Customers', Icon: Users },
  { route: 'settings', label: 'More', Icon: DotsThree }
]

/** The Guided shell: Back + title, the status pill, the page, a four-tab nav (hidden in the editor). Guards stay in App.tsx. */
export function GuidedShell(props: ShellProps): ReactElement {
  const editing = props.route === 'create'
  return (
    <div className="q3-shell q3x-guided">
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
          {GUIDED_TABS.map(({ route, label, Icon }) => {
            const on = props.activeTab === route
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
