import { useEffect, useState, type ReactElement } from 'react'
import type { PhoneDb } from '../data/db'
import { createAppLock, isValidPin, PIN_MAX, PIN_MIN, type AppLock } from '../sync/appLock'

/** Settings > App lock (Phase 185). Optional, OFF by default [A unconfirmed]. Honest note: it keeps out someone who opens the app;
 *  it does not encrypt the bills. No biometric (Standing gap). */
export function SettingsLock(props: { db: PhoneDb; appLock?: AppLock; onChanged?: () => void }): ReactElement {
  const { db } = props
  const [lock] = useState<AppLock>(() => props.appLock ?? createAppLock(db))
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { void lock.isEnabled().then(setEnabled, () => setEnabled(false)) }, [lock])
  const clear = (): void => { setPin(''); setAgain('') }

  const turnOn = async (): Promise<void> => {
    setError(null); setMessage(null)
    if (!isValidPin(pin)) { setError(`Use ${PIN_MIN} to ${PIN_MAX} digits.`); return }
    if (pin !== again) { setError('The two PINs are not the same.'); return }
    if (await lock.setPin(pin)) { setEnabled(true); setMessage('App lock is on. The PIN is asked when the app opens.'); props.onChanged?.() } else setError(`Use ${PIN_MIN} to ${PIN_MAX} digits.`)
    clear()
  }
  const turnOff = async (): Promise<void> => {
    setError(null); setMessage(null)
    if (await lock.disable(pin)) { setEnabled(false); setMessage('App lock is off.'); props.onChanged?.() } else setError('That PIN is not right.')
    clear()
  }

  if (enabled === null) return <section className="q3-set" aria-label="App lock"><h2 className="q3-h2">App lock</h2><p className="q3-muted" role="status">Loading</p></section>
  return (
    <section className="q3-set" aria-label="App lock">
      <h2 className="q3-h2">App lock</h2>
      <div className="q3-row"><span>Status</span><span>{enabled ? 'On' : 'Off'}</span></div>
      <label className="q3-field"><span className="q3-muted">{enabled ? 'Current PIN' : 'New PIN'}</span>
        <input className="q3-input" aria-label={enabled ? 'Current PIN' : 'New PIN'} type="password" inputMode="numeric" autoComplete="off" maxLength={PIN_MAX} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
      </label>
      {!enabled ? (
        <label className="q3-field"><span className="q3-muted">Repeat PIN</span>
          <input className="q3-input" aria-label="Repeat PIN" type="password" inputMode="numeric" autoComplete="off" maxLength={PIN_MAX} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))} />
        </label>
      ) : null}
      <button type="button" className="q3-btn q3-btn-primary" disabled={!db.canWrite()} onClick={() => void (enabled ? turnOff() : turnOn())}>{enabled ? 'Turn off app lock' : 'Turn on app lock'}</button>
      <p className="q3-muted">The lock keeps out someone who picks up your phone and opens the app. It does not encrypt your bills.</p>
      {message ? <p className="q3-note" role="status">{message}</p> : null}
      {error ? <p className="q3-note q3-note-warn" role="alert">{error}</p> : null}
    </section>
  )
}
