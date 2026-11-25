import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  RESTORE_BUTTON_RETRY, RESTORE_BUTTON_SERVER, RESTORE_LIMIT_LINE, RESTORE_SERVER_INTRO, RESTORE_SERVER_TITLE, restoreCountLine, restoreStageWords,
  type RestoreExtra, type RestoreProgress
} from '../sync/restore'
import type { RestoreApi } from './services'

const EXTRA_WORDS: Record<RestoreExtra, string> = { company: 'company details', payments: 'the payments list', rights: 'this phone\'s rights' }

/**
 * Phase 293 - the ONE progress screen of a restore (shared by every layout; App draws it before any layout). Two ways in:
 *  - `code`: the code was just accepted on a blank phone; the restore starts at once (no questions: scope `all`);
 *  - `server`: the phone is still signed in but its data is gone; one button, "Restore from the server", no code.
 * Counts by kind, never a blank wait. A failure is plain words with "Try again" (it resumes). Ends by calling `onDone` (the Dashboard).
 * Nothing here wipes or overwrites anything.
 */
export function RestoreScreen(props: { api: RestoreApi; mode: 'code' | 'server'; onDone: () => void; onNotNow?: () => void }): ReactElement {
  const [phase, setPhase] = useState<'idle' | 'running' | 'failed' | 'done'>(props.mode === 'code' ? 'running' : 'idle')
  const [progress, setProgress] = useState<RestoreProgress | null>(null)
  const [message, setMessage] = useState('')
  const [later, setLater] = useState<RestoreExtra[]>([])
  const started = useRef(false)
  const busy = useRef(false)

  const run = async (): Promise<void> => {
    if (busy.current) return
    busy.current = true
    setPhase('running'); setMessage('')
    try {
      const r = await props.api.run((p) => setProgress(p))
      if (r.ok) { setLater(r.later); setPhase('done'); props.onDone(); return }
      setMessage(r.message); setPhase('failed')
    } catch {
      setMessage('Something went wrong. Try again.'); setPhase('failed')
    } finally { busy.current = false }
  }

  useEffect(() => {
    if (props.mode !== 'code' || started.current) return
    started.current = true
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const line = progress ? restoreCountLine(progress) : ''
  return (
    <div className="q3-shell">
      <main className="q3-main q3-lock" aria-label="Restoring this phone" aria-busy={phase === 'running'}>
        <h1>{props.mode === 'server' && phase === 'idle' ? RESTORE_SERVER_TITLE : 'Restoring this phone'}</h1>
        {phase === 'idle' ? <p className="q3-muted">{RESTORE_SERVER_INTRO}</p> : null}
        {phase === 'running' || phase === 'done' ? <p className="q3-muted" role="status">{restoreStageWords(progress?.stage ?? 'compare')}</p> : null}
        {line !== '' && (phase === 'running' || phase === 'done') ? <p role="status">{line}</p> : null}
        {phase === 'done' && later.length > 0 ? <p className="q3-muted">Could not fetch {later.map((k) => EXTRA_WORDS[k]).join(', ')} yet. The phone tries again by itself while it syncs.</p> : null}
        {phase === 'failed' ? <p className="q3-note q3-note-warn" role="alert">{message} Nothing was lost. Try again picks up where it stopped.</p> : null}
        {phase === 'idle' ? <button type="button" className="q3-btn q3-btn-primary" onClick={() => void run()}>{RESTORE_BUTTON_SERVER}</button> : null}
        {phase === 'failed' ? <button type="button" className="q3-btn q3-btn-primary" onClick={() => void run()}>{RESTORE_BUTTON_RETRY}</button> : null}
        {phase === 'idle' && props.onNotNow ? <button type="button" className="q3-btn" onClick={props.onNotNow}>Not now</button> : null}
        <p className="q3-muted">{RESTORE_LIMIT_LINE}</p>
      </main>
    </div>
  )
}
