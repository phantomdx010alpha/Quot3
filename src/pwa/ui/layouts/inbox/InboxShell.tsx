import { ArrowLeft, Gear, Plus, Users } from '@phosphor-icons/react'
import type { ReactElement } from 'react'
import { StatusPill } from '../../kit/StatusPill'
import type { ShellProps } from '../types'
import '../../kit/kit.css'
import '../layouts.css'
import '../tidy/tidy.css'
import './inbox.css'

/** Bills inbox shell (Phase 194): NO bottom nav. Back and the title on the left; Customers and Settings (the gear) in the top bar; a floating "New bill" on Home.
 *  Guards stay in App.tsx: Back and the icons only call what App gave. */
export function InboxShell(props: ShellProps): ReactElement {
  const editing = props.route === 'create'
  return (
    <div className="q3-shell q3x-inbox">
      <header className="q3x-tidy-bar">
        {props.canGoBack ? (
          <button type="button" className="q3x-tidy-back" onClick={props.onBack} aria-label="Back"><ArrowLeft size={22} weight="bold" aria-hidden="true" /></button>
        ) : null}
        <h1 className="q3x-tidy-title">{props.title ?? 'Quot3'}</h1>
        {editing ? null : (
          <div className="q3x-inbox-icons">
            <button type="button" className="q3x-inbox-icon" aria-label="Customers" onClick={() => props.onSelectTab('customers')}><Users size={24} weight={props.activeTab === 'customers' ? 'bold' : 'light'} aria-hidden="true" /></button>
            <button type="button" className="q3x-inbox-icon" aria-label="Settings" onClick={() => props.onSelectTab('settings')}><Gear size={24} weight={props.activeTab === 'settings' ? 'bold' : 'light'} aria-hidden="true" /></button>
          </div>
        )}
      </header>
      {props.status ? <StatusPill flags={props.status} onAction={props.onStatusAction} /> : null}
      <main className="q3-main q3x-tidy-main">{props.children}</main>
      {props.route === 'home' ? (
        <button type="button" className="q3x-inbox-fab" aria-label="New bill" onClick={() => props.onSelectTab('create')}><Plus size={26} weight="bold" aria-hidden="true" /><span>New bill</span></button>
      ) : null}
    </div>
  )
}
