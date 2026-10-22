import { useEffect, useState, type ReactElement } from 'react'
import type { PhoneDb } from '../data/db'
import { getBranchLink, validateLinkInput, type BranchLink, type LinkFieldErrors, type LinkInput } from '../sync/branch'
import { DEFAULT_RECENT_BILLS, type FirstSyncPreview } from '../sync/firstSync'
import type { EngineState, PhoneSyncEngine } from '../sync/engine'
import { toSyncFailure } from '../sync/errors'
import type { SyncAdmin } from './services'
import { AdvancedFold } from './layouts/shared/AdvancedFold'
import { settingsWords } from './layouts/shared/SettingsWords'

const STATE_TEXT: Record<EngineState, string> = {
  stopped: 'Sync is stopped. Tap Start sync.',
  not_linked: 'Not linked yet.',
  read_only: 'Quot3 is open in another window, so this one cannot sync. Close the other window.',
  first_sync_needed: 'Signed in. Choose what to download for the first sync.',
  running: 'Syncing is on while this app is open.'
}

/** The sync controls shown once the phone is linked: the first-sync choice, then Sync now (Phase 187b). */
function SyncPanel(props: { engine: PhoneSyncEngine; onChanged?: () => void }): ReactElement {
  const { engine } = props
  const [state, setState] = useState<EngineState>(engine.state())
  const [preview, setPreview] = useState<FirstSyncPreview | null>(null)
  const [scope, setScope] = useState<'all' | 'recent'>('all')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true); setNote(null)
    try { await fn() } catch (e) { setNote(toSyncFailure(e).message) } finally { setState(engine.state()); setBusy(false) }
  }
  useEffect(() => {
    setState(engine.state())
    const t = setInterval(() => setState(engine.state()), 1500)
    return () => clearInterval(t)
  }, [engine])
  return (
    <div className="q3-set" aria-label="Sync controls">
      <p className="q3-muted" role="status">{STATE_TEXT[state]}</p>
      {state === 'first_sync_needed' && !preview ? (
        <button type="button" className="q3-btn q3-btn-primary" disabled={busy} onClick={() => void run(async () => { const p = await engine.prepareFirstSync(); setPreview(p); setScope(p.assessment.recommended.mode === 'recent' ? 'recent' : 'all') })}>
          {busy ? 'Checking…' : 'Check what to download'}
        </button>
      ) : null}
      {state === 'first_sync_needed' && preview ? (
        <>
          <p className="q3-note">{preview.assessment.note}</p>
          <label className="q3-row"><input type="radio" name="fs-scope" checked={scope === 'all'} onChange={() => setScope('all')} /> <span>Download everything</span></label>
          <label className="q3-row"><input type="radio" name="fs-scope" checked={scope === 'recent'} onChange={() => setScope('recent')} /> <span>Newest {DEFAULT_RECENT_BILLS} bills and all customers (older bills can be loaded later)</span></label>
          <button type="button" className="q3-btn q3-btn-primary" disabled={busy} onClick={() => void run(async () => {
            const r = await engine.completeFirstSync(preview, scope === 'all' ? { mode: 'all' } : { mode: 'recent', billLimit: DEFAULT_RECENT_BILLS })
            setPreview(null); setNote(`First sync done. ${r.queued} records queued to send.`); props.onChanged?.()
          })}>{busy ? 'Syncing…' : 'Start syncing'}</button>
        </>
      ) : null}
      {state === 'running' ? (
        <button type="button" className="q3-btn" disabled={busy} onClick={() => void run(async () => { await engine.syncNow(); setNote('Synced.'); props.onChanged?.() })}>{busy ? 'Syncing…' : 'Sync now'}</button>
      ) : null}
      {state === 'stopped' || state === 'not_linked' ? (
        <button type="button" className="q3-btn" disabled={busy} onClick={() => void run(async () => { await engine.start() })}>Start sync</button>
      ) : null}
      {note ? <p className="q3-note" role="status">{note}</p> : null}
    </div>
  )
}

const BLANK = { supabaseUrl: '', anonKey: '', licenseKey: '', email: '', password: '', branchName: '', poPrefix: '' }
type Form = typeof BLANK
const ADVANCED: (keyof Form)[] = ['supabaseUrl', 'anonKey', 'licenseKey']
const LABELS: Record<keyof Form, string> = {
  supabaseUrl: 'Supabase URL', anonKey: 'Public (anon) key', licenseKey: 'License key', email: 'Seat email', password: 'Seat password', branchName: 'Branch name for this phone', poPrefix: 'PO prefix'
}

/** Settings > Branch and sync login (Phase 185). The phone is its own seat and own branch [A unconfirmed].
 *  The form checks with the shared validators first; the real sign-in is `sync.link` (Phase 178). The password is never kept after the call. */
/** `plain` (Phase 195, new layouts only): plain words, and the Supabase URL / anon key / license key sit in a closed Advanced fold (values kept, still reachable). */
export function SettingsSync(props: { db: PhoneDb; plain?: boolean; sync?: SyncAdmin | null; engine?: PhoneSyncEngine | null; onChanged?: () => void }): ReactElement {
  const { db, sync } = props
  const [link, setLink] = useState<BranchLink | null>(null)
  const [form, setForm] = useState<Form>(BLANK)
  const [errors, setErrors] = useState<LinkFieldErrors>({})
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const words = settingsWords(props.plain)

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
        setForm(BLANK); setMessage(`Signed in. This phone is branch “${r.branchName}” (${r.poPrefix}). Now choose what to download for the first sync.`); refresh(); props.onChanged?.()
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

  const keys = Object.keys(BLANK) as (keyof Form)[]
  const renderField = (k: keyof Form): ReactElement => (
    <label key={k} className="q3-field">
      <span className="q3-muted">{words.t(LABELS[k])}</span>
      <input
        className="q3-input" aria-label={words.t(LABELS[k])} value={form[k]} onChange={set(k)} disabled={!sync || busy}
        type={k === 'password' ? 'password' : k === 'email' ? 'email' : 'text'} autoComplete={k === 'password' ? 'current-password' : 'off'} autoCapitalize="off" spellCheck={false}
      />
      {errors[k] ? <span className="q3-note q3-note-warn" role="alert">{errors[k]}</span> : null}
    </label>
  )

  return (
    <section className="q3-set" aria-label={words.t('Branch and sync')}>
      <h2 className="q3-h2">{words.t('Branch and sync')}</h2>
      {link?.linked ? (
        <>
          <div className="q3-row"><span>Branch</span><span>{link.branchName}</span></div>
          <div className="q3-row"><span>{words.t('PO prefix')}</span><span>{link.poPrefix}</span></div>
          <p className="q3-muted">The branch name and {words.t('PO prefix').toLowerCase()} are fixed once this phone is linked.</p>
          {props.engine ? <SyncPanel engine={props.engine} onChanged={props.onChanged} /> : null}
          <button type="button" className="q3-btn" disabled={!sync || busy} onClick={() => void signOut()}>Sign out of sync</button>
        </>
      ) : (
        <>
          <p className="q3-muted">Not linked. Sign in with a seat from your organisation to share bills with your other computers.</p>
          {!sync ? <p className="q3-note">Sync sign-in is not available right now (the phone data could not be opened).</p> : null}
          {keys.filter((k) => !(words.plain && ADVANCED.includes(k))).map(renderField)}
          {words.plain ? <AdvancedFold forceOpen={ADVANCED.some((k) => Boolean(errors[k]))}>{ADVANCED.map(renderField)}</AdvancedFold> : null}
          <button type="button" className="q3-btn q3-btn-primary" disabled={!sync || busy || !db.canWrite()} onClick={() => void submit()}>Sign in</button>
        </>
      )}
      {message ? <p className="q3-note" role="status">{message}</p> : null}
    </section>
  )
}
