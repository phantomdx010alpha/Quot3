import { useState, type ReactElement } from 'react'
import { PIN_MAX, type AppLock } from '../sync/appLock'

/** The PIN screen shown at start when the app lock is on (Phase 185). Wrong tries are counted by `AppLock.verify` (waiting time grows). */
export function LockScreen(props: { lock: AppLock; onUnlocked: () => void }): ReactElement {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    if (busy || pin === '') return
    setBusy(true); setError(null)
    try {
      const r = await props.lock.verify(pin)
      if (r.ok) { props.onUnlocked(); return }
      setError(r.lockedForMs > 0 ? `Too many wrong tries. Wait ${Math.ceil(r.lockedForMs / 1000)} seconds.` : `That PIN is not right. ${r.triesLeft} tries before a wait.`)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setPin(''); setBusy(false) }
  }
  return (
    <div className="q3-shell">
      <main className="q3-main q3-lock" role="dialog" aria-modal="true" aria-label="App lock">
        <h1>Quot3 is locked</h1>
        <input className="q3-input" aria-label="PIN" type="password" inputMode="numeric" autoComplete="off" maxLength={PIN_MAX} autoFocus value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') void submit() }} />
        <button type="button" className="q3-btn q3-btn-primary" disabled={busy} onClick={() => void submit()}>Unlock</button>
        {error ? <p className="q3-note q3-note-warn" role="alert">{error}</p> : null}
      </main>
    </div>
  )
}
