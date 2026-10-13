import { syncBadge } from '@shared/sync/manager'

/** Phase 59 - the small per-bill sync mark in History (Synced / Waiting / Conflict). Bills that never left this computer show nothing. */
export function SyncBadgeMark({ state }: { state: string | undefined }): React.JSX.Element | null {
  const b = syncBadge(state)
  if (!b) return null
  return <span className={`q3-sybadge q3-sybadge--${b.tone}`} title={b.title} aria-label={`Sync: ${b.text}`}>{b.text}</span>
}
