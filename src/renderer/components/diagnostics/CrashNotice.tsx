import { useEffect } from 'react'
import { describeCrashNotice } from '@shared/diagnostics'
import { Button } from '../ui'
import { useDiagnosticsStore } from '../../stores/diagnosticsStore'

const when = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Phase 61 - Dashboard message after an unclean exit. Stays until dismissed; Copy diagnostics is one click away. */
export function CrashNotice(): React.JSX.Element | null {
  const notice = useDiagnosticsStore((s) => s.notice)
  const message = useDiagnosticsStore((s) => s.message)
  useEffect(() => { void useDiagnosticsStore.getState().loadNotice() }, [])
  if (!notice) return null
  const text = describeCrashNotice(notice)
  const at = when(notice.at)
  return (
    <section className="q3-crash" role="status" aria-label="Last run" data-testid="crash-notice">
      <h2 className="q3-crash__title">{text.title}</h2>
      <p className="q3-crash__body">{text.body}{at !== '' ? ` (${at})` : ''}</p>
      <div className="q3-set__row">
        <Button size="sm" variant="ghost" onClick={() => { void useDiagnosticsStore.getState().copy() }}>Copy diagnostics</Button>
        <Button size="sm" variant="primary" onClick={() => { void useDiagnosticsStore.getState().dismissNotice() }}>Dismiss</Button>
      </div>
      {message !== '' && <p className="q3-set__muted" role="status">{message}</p>}
    </section>
  )
}
