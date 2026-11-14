import { useState, type ReactElement } from 'react'
import type { PhoneDb } from '../data/db'
import { getBranchLink } from '../sync/branch'
import type { RedeemResult } from '../sync/master'
import type { PhoneSyncEngine } from '../sync/engine'
import { SEAT_REMOVED_WORDS } from '../sync/recredential'
import { codeFeedback } from './connectCodeModel'
import type { SyncAdmin } from './services'
import { SettingsSync } from './SettingsSync'

/** What the screen needs from the running app (`AppServices.connectCode`). */
export interface ConnectCodeApi {
  ready(): boolean
  redeem(code: string, opts?: { branchName?: string; poPrefix?: string }): Promise<RedeemResult>
}

/**
 * Phase 269 - the ONE-FIELD first-launch screen (an unlinked phone) and the "seat removed" screen (a linked phone whose seat the admin took away).
 * Shared by every layout: App shows it before any layout draws. One input (paste-friendly), the check character is verified as you type,
 * "Connect" redeems the code, then the app goes straight to the existing first-sync choice. "Advanced: enter details by hand" opens the old form [A].
 * Nothing is wiped when a seat is removed: bills stay on the phone, only syncing stops until a new code is entered.
 */
export function ConnectCode(props: {
  db: PhoneDb
  mode: 'first' | 'removed'
  connect: ConnectCodeApi
  sync?: SyncAdmin | null
  engine?: PhoneSyncEngine | null
  onLinked: () => void
  onNotNow: () => void
}): ReactElement {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const fb = codeFeedback(code)

  const submit = async (): Promise<void> => {
    if (busy || !fb.canConnect) return
    setBusy(true); setError(null)
    try {
      // A removed seat keeps its branch name and PO prefix (they are fixed once the phone issued numbers).
      const link = props.mode === 'removed' ? await getBranchLink(props.db) : null
      const r = await props.connect.redeem(code, link?.linked && link.branchName && link.poPrefix ? { branchName: link.branchName, poPrefix: link.poPrefix } : undefined)
      if (r.ok) { setCode(''); props.onLinked(); return }
      setError(r.message)
    } catch {
      setError('Something went wrong. Try again.')
    } finally { setBusy(false) }
  }

  return (
    <div className="q3-shell">
      <main className="q3-main q3-lock" aria-label={props.mode === 'removed' ? 'Seat removed' : 'Connect to your company'}>
        {props.mode === 'removed' ? (
          <>
            <h1>This seat was removed</h1>
            <p className="q3-muted">{SEAT_REMOVED_WORDS} Your bills stay on this phone.</p>
          </>
        ) : (
          <>
            <h1>Connect to your company</h1>
            <p className="q3-muted">Enter the code your admin gave you.</p>
          </>
        )}
        <input
          className="q3-input" aria-label="Company code" value={code} autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy}
          placeholder="Q3C-XXXX-XXXX-XXXX" onChange={(e) => { setCode(e.target.value); setError(null) }} onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
        />
        {fb.text !== '' ? <p className={fb.state === 'bad' ? 'q3-note q3-note-warn' : 'q3-muted'} role={fb.state === 'bad' ? 'alert' : 'status'}>{fb.text}</p> : null}
        <button type="button" className="q3-btn q3-btn-primary" disabled={busy || !fb.canConnect} onClick={() => void submit()}>{busy ? 'Connecting…' : 'Connect'}</button>
        {busy ? <p className="q3-muted" role="status">Connecting to your company. This takes a few seconds.</p> : null}
        {error ? <p className="q3-note q3-note-warn" role="alert">{error}</p> : null}
        <button type="button" className="q3-btn" disabled={busy} onClick={props.onNotNow}>Not now</button>
        <button type="button" className="q3-btn" disabled={busy} aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>Advanced: enter details by hand</button>
        {advanced ? <SettingsSync db={props.db} plain sync={props.sync} engine={props.engine} onChanged={props.onLinked} /> : null}
      </main>
    </div>
  )
}
