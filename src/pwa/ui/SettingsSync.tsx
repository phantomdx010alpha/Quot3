import { useEffect, useState, type ReactElement } from 'react'
import type { PhoneDb } from '../data/db'
import { getBranchLink, validateLinkInput, type BranchLink, type LinkFieldErrors, type LinkInput } from '../sync/branch'
import type { SyncAdmin } from './services'

const BLANK = { supabaseUrl: '', anonKey: '', licenseKey: '', email: '', password: '', branchName: '', poPrefix: '' }
type Form = typeof BLANK
const LABELS: Record<keyof Form, string> = {
  supabaseUrl: 'Supabase URL', anonKey: 'Public (anon) key', licenseKey: 'License key', email: 'Seat email', password: 'Seat password', branchName: 'Branch name for this phone', poPrefix: 'PO prefix'
}

/** Settings > Branch and sync login (Phase 185). The phone is its own seat and own branch [A unconfirmed].
 *  The form checks with the shared validators first; the real sign-in is `sync.link` (Phase 178). The password is never kept after the call. */
export function SettingsSync(props: { db: PhoneDb; sync?: SyncAdmin | null; onChanged?: () => void }): ReactElement {
  const { db, sync } = props
  const [link, setLink] = useState<BranchLink | null>(null)
  const [form, setForm] = useState<Form>(BLANK)
  const [errors, setErrors] = useState<LinkFieldErrors>({})
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = (): void => { void getBranchLink(db).then(setLink, () => setLink(null)) }
  useEffect(() => { refresh() }, [db]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof Form) => (e: { target: { value: string } }): void => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (): Promise<void> => {
    if (busy || !sync) return
    const checked = validateLinkInput(form)
    if (!checked.ok) { setErrors(checked.errors); setMessage(null); return }
    setBusy(true); setErrors({}); setMessage(null)
    try {
      const input: LinkInput = { ...form, device: 'Android phone' }
      const r = await sync.link(input)
      if (r.ok) {
        setForm(BLANK); setMessage(`Signed in. This phone is branch “${r.branchName}” (${r.poPrefix}).`); refresh(); props.onChanged?.()
      } else if (r.code === 'VALIDATION' || r.code === 'PREFIX_LOCKED' || r.code === 'SYNC') {
        setErrors(r.errors)
        setMessage(r.code === 'PREFIX_LOCKED' ? r.message : r.code === 'SYNC' ? r.failure.message : 'Check the fields marked below.')
      } else setMessage(r.message)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setForm((f) => ({ ...f, password: '' }))
      setBusy(false)
    }
  }

  const signOut = async (): Promise<void> => {
    if (!sync || busy) return
    setBusy(true)
    try { await sync.signOut(); setMessage('Signed out. Bills stay on this phone; syncing is paused.'); props.onChanged?.() } catch (e) { setMessage(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <section className="q3-set" aria-label="Branch and sync">
      <h2 className="q3-h2">Branch and sync</h2>
      {link?.linked ? (
        <>
          <div className="q3-row"><span>Branch</span><span>{link.branchName}</span></div>
          <div className="q3-row"><span>PO prefix</span><span>{link.poPrefix}</span></div>
          <p className="q3-muted">The branch name and PO prefix are fixed once this phone is linked.</p>
          <button type="button" className="q3-btn" disabled={!sync || busy} onClick={() => void signOut()}>Sign out of sync</button>
        </>
      ) : (
        <>
          <p className="q3-muted">Not linked. Sign in with a seat from your organisation to share bills with your other computers.</p>
          {!sync ? <p className="q3-note">Sync sign-in is not available in this build yet.</p> : null}
          {(Object.keys(BLANK) as (keyof Form)[]).map((k) => (
            <label key={k} className="q3-field">
              <span className="q3-muted">{LABELS[k]}</span>
              <input
                className="q3-input" aria-label={LABELS[k]} value={form[k]} onChange={set(k)} disabled={!sync || busy}
                type={k === 'password' ? 'password' : k === 'email' ? 'email' : 'text'} autoComplete={k === 'password' ? 'current-password' : 'off'} autoCapitalize="off" spellCheck={false}
              />
              {errors[k] ? <span className="q3-note q3-note-warn" role="alert">{errors[k]}</span> : null}
            </label>
          ))}
          <button type="button" className="q3-btn q3-btn-primary" disabled={!sync || busy || !db.canWrite()} onClick={() => void submit()}>Sign in</button>
        </>
      )}
      {message ? <p className="q3-note" role="status">{message}</p> : null}
    </section>
  )
}
