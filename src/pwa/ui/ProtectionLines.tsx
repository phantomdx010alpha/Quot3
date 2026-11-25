import type { ReactElement } from 'react'
import { KEEP_MY_DATA_LABEL, persistBanner, unsyncedLine, type ProtectionActionId, type ProtectionState } from '../platform/protectionState'

/** Layout of one line (tokens only). Not `q3-banner`: the new layouts replace banners with the status pill (their tests check that). */
const ROW = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' } as const

/** Phase 292 - the calm "your phone may delete this data" banner and the unsynced-bills line, shown on the Dashboard of every layout
 *  (App renders it once, above the home screen). Renders NOTHING when there is nothing to say, so classic is unchanged. Warn only. */
export function ProtectionLines(props: {
  state: ProtectionState | null
  linked: boolean
  persistApi: boolean
  canInstall: boolean
  canSync: boolean
  disabled?: boolean
  onAction: (id: ProtectionActionId | 'sync') => void
}): ReactElement | null {
  const { state } = props
  if (!state) return null
  const banner = persistBanner(state, { persistApi: props.persistApi, canInstall: props.canInstall })
  const line = unsyncedLine(state, props.linked)
  if (!banner && !line) return null
  return (
    <section className="q3-protect" aria-label="Data protection" data-testid="protection-lines">
      {banner ? (
        <div className="q3-note q3-note-warn" style={ROW} role="status" data-testid="protect-banner">
          <span>{banner.text}{banner.steps ? ` ${banner.steps}` : ''}</span>
          {banner.actions.includes('keep') ? <button type="button" className="q3-btn q3-btn-primary" disabled={props.disabled} onClick={() => props.onAction('keep')}>{KEEP_MY_DATA_LABEL}</button> : null}
          {banner.actions.includes('install') ? <button type="button" className="q3-btn" onClick={() => props.onAction('install')}>Install</button> : null}
        </div>
      ) : null}
      {line ? (
        <div className="q3-note q3-note-warn" style={ROW} role="status" data-testid="protect-unsynced">
          <span>{line}</span>
          {props.canSync ? <button type="button" className="q3-btn" disabled={props.disabled} onClick={() => props.onAction('sync')}>Sync now</button> : null}
        </div>
      ) : null}
    </section>
  )
}
