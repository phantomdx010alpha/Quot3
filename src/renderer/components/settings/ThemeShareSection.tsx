import { useCallback, useEffect, useState } from 'react'
import type { Quot3Bridge } from '@shared/ipc'
import type { ThemeShareStatus } from '@shared/theme/themeShare'
import { Badge, Button } from '../ui'

const REASON_TEXT = { invalid: 'Not a valid theme, not applied', too_new: 'Needs a newer app', too_big: 'Too large, not applied', io: 'Could not be saved here, will be tried again' } as const

/** Phase 171: Settings > Themes > Share themes. Switch (OFF by default), the shared themes with their origin and a local-only Remove, and the themes that were set aside. Ids and names only: never theme contents. */
export function ThemeShareSection(): React.JSX.Element | null {
  const [st, setSt] = useState<ThemeShareStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [note, setNote] = useState('')
  const api = (): Quot3Bridge['themes'] | undefined => (window as unknown as { quot3?: Quot3Bridge }).quot3?.themes

  const refresh = useCallback(async () => {
    const r = await api()?.shareStatus?.()
    if (r?.ok) setSt(r.data)
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  if (!st) return null

  const toggle = async (on: boolean): Promise<void> => {
    setProblem(''); setNote(''); setBusy(true)
    const r = await api()?.shareSetEnabled(on)
    setBusy(false)
    if (!r) setProblem('Not available (no connection to the app).')
    else if (!r.ok) setProblem(r.error.message)
    else setSt(r.data)
  }
  const syncNow = async (): Promise<void> => {
    setProblem(''); setNote(''); setBusy(true)
    const r = await api()?.shareSyncNow()
    setBusy(false)
    if (!r) { setProblem('Not available (no connection to the app).'); return }
    if (!r.ok) { setProblem(r.error.message); return }
    setSt(r.data.status)
    const { sent, received, setAside } = r.data.run
    setNote(`Sent ${sent}, received ${received}${setAside > 0 ? `, set aside ${setAside}` : ''}.`)
  }
  const remove = async (id: string): Promise<void> => {
    setProblem(''); setNote('')
    const r = await api()?.removeShared(id)
    if (!r) setProblem('Not available (no connection to the app).')
    else if (!r.ok) setProblem(r.error.message)
    else { setSt(r.data); setNote('Removed from this PC only. A copy is kept in the themes\\history folder.') }
  }

  return (
    <fieldset className="q3-set__form q3-share" aria-label="Share themes">
      <legend>Share themes</legend>
      <label className="q3-set__check">
        <input type="checkbox" checked={st.enabled} disabled={busy} onChange={(e) => { void toggle(e.target.checked) }} /> Share my themes with the other PCs
      </label>
      <p className="q3-set__muted">
        Themes you add here are sent through the shared notebook and appear in the other PCs' theme lists; themes from the other PCs appear here. The newest edit wins and the older copy is kept.
        Removing a theme only removes it on this PC.
      </p>
      {!st.available && <p className="q3-set__muted">Sign in to the shared notebook (Settings &gt; Sync) to use this.</p>}
      {st.notice !== '' && <p role="status" className="q3-set__error">{st.notice}</p>}
      {st.enabled && st.shared.length === 0 && st.aside.length === 0 && <p className="q3-set__muted">No shared themes yet.</p>}
      {st.shared.length > 0 && (
        <ul className="q3-share__list" aria-label="Shared themes">
          {st.shared.map((t) => (
            <li key={t.id} className="q3-share__item">
              <span className="q3-theme__name">{t.name}</span>
              <Badge>{t.origin === null ? 'From another PC' : t.origin === 'This PC' ? 'Added on this PC' : `From ${t.origin}`}</Badge>
              <Button variant="ghost" aria-label={`Remove ${t.name} from this PC`} onClick={() => { void remove(t.id) }}>Remove from this PC</Button>
            </li>
          ))}
        </ul>
      )}
      {st.aside.length > 0 && (
        <div role="status">
          <p className="q3-set__muted">Set aside (not applied):</p>
          <ul className="q3-share__list" aria-label="Set aside themes">
            {st.aside.map((a) => (
              <li key={a.id} className="q3-share__item">
                <strong>{a.id}</strong> <span className="q3-set__muted">{REASON_TEXT[a.reason]}{a.message !== '' && a.reason !== 'too_new' ? `: ${a.message}` : ''}</span>
                <Button variant="ghost" aria-label={`Dismiss ${a.id}`} onClick={() => { void remove(a.id) }}>Dismiss</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {st.last?.error ? <p role="alert" className="q3-set__error">{st.last.error}</p> : null}
      {problem !== '' && <p role="alert" className="q3-set__error">{problem}</p>}
      {note !== '' && <p role="status" className="q3-set__saved">{note}</p>}
      <div className="q3-set__row">
        <Button variant="ghost" disabled={busy || !st.enabled || !st.available} onClick={() => { void syncNow() }}>Sync themes now</Button>
      </div>
    </fieldset>
  )
}
