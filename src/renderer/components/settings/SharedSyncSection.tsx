import { useEffect, useRef, useState } from 'react'
import { DEACTIVATE_WORD } from '@shared/sync/license'
import { EMPTY_SHARED_FORM, NAME_CHECK_DEBOUNCE_MS, nameStateText, validateSharedForm, type SharedForm, type SharedFormField } from '@shared/sync/sharedUi'
import { Button, Dialog, Input } from '../ui'
import { SYNC_FOCUS_NAME_EVENT, sharedBridge, useSharedSyncStore } from '../../stores/sharedSyncStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSyncStatusStore } from '../../stores/syncStatusStore'

const when = (iso: string | null): string => {
  if (iso === null || iso === '') return 'Not yet'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'Not yet' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const LICENSE_SHOW_MS = 30_000

/**
 * Version 0.1.31 - "Show license key": the owner's own computer already holds the key (encrypted); a click asks main for it once, it is
 * shown for 30 seconds in text that can be selected, with a Copy button, and then hidden again. It is never kept in the store.
 */
export function LicenseReveal(): React.JSX.Element | null {
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState('')
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (hide.current) clearTimeout(hide.current) }, [])
  const bridge = sharedBridge()
  if (!bridge?.revealLicense) return null
  const reveal = async (): Promise<void> => {
    setMsg('')
    try {
      const r = await bridge.revealLicense!()
      if (!r.ok) { setKey(''); setMsg(r.error.message); return }
      setKey(r.data.license)
      if (hide.current) clearTimeout(hide.current)
      hide.current = setTimeout(() => { setKey(''); setMsg('Hidden again.') }, LICENSE_SHOW_MS)
    } catch { setKey(''); setMsg('Something went wrong. Try again.') }
  }
  const copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(key); setMsg('License key copied.') } catch { setMsg('Could not copy. Select the key and press Ctrl+C.') }
  }
  return (
    <div className="q3-set__form" aria-label="License key">
      {key !== '' ? (
        <>
          <p className="q3-set__muted">Your license key (hides itself in 30 seconds). Keep it private; anyone with it and a login can join your notebook.</p>
          <code data-testid="license-key" style={{ userSelect: 'text', fontSize: '1.1em' }}>{key}</code>
          <div className="q3-set__row">
            <Button variant="primary" onClick={() => { void copy() }}>Copy license key</Button>
            <Button variant="ghost" onClick={() => { if (hide.current) clearTimeout(hide.current); setKey(''); setMsg('') }}>Hide</Button>
          </div>
        </>
      ) : (
        <div className="q3-set__row"><Button variant="ghost" onClick={() => { void reveal() }}>Show license key</Button></div>
      )}
      {msg !== '' && <p role="status" className="q3-set__saved">{msg}</p>}
    </div>
  )
}

/**
 * Phase 139 - Settings > Sync, version 2 (shared notebook). Sign in with this computer's e-mail and password (given with the
 * license), choose the branch name (checked live) and the PO prefix; then see the branches, rename this one, Sync now, Compare
 * and sync. No passphrase exists here. Passwords and keys are typed once and never shown again; the screen only ever gets masked hints.
 * Every control is a normal focusable control, and Sync now / Compare and sync / Rename have palette entries.
 */
export function SharedSyncSection(): React.JSX.Element {
  const st = useSharedSyncStore()
  const { status, branches, busy, error, notice, routed, nameState, compareNote } = st
  const localPrefix = useSettingsStore((s) => s.data?.branch?.prefix ?? '')
  const overview = useSyncStatusStore((s) => s.overview)
  const [form, setForm] = useState<SharedForm>(EMPTY_SHARED_FORM)
  const [touched, setTouched] = useState(false)
  const [renameTo, setRenameTo] = useState('')
  const [offOpen, setOffOpen] = useState(false)
  const [word, setWord] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const renameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { void useSharedSyncStore.getState().load() }, [])
  useEffect(() => { if (form.poPrefix === '' && localPrefix !== '') setForm((f) => (f.poPrefix === '' ? { ...f, poPrefix: localPrefix } : f)) }, [localPrefix, form.poPrefix])
  useEffect(() => {
    const go = (): void => { (renameRef.current ?? nameRef.current)?.focus() }
    window.addEventListener(SYNC_FOCUS_NAME_EVENT, go)
    return () => window.removeEventListener(SYNC_FOCUS_NAME_EVENT, go)
  }, [])
  const activated = status?.state === 'activated'

  // Live "name free?" check, debounced; stale answers are dropped inside the store.
  const checkKey = activated ? renameTo : form.branchName
  useEffect(() => {
    const t = setTimeout(() => { void useSharedSyncStore.getState().checkName(checkKey, activated ? undefined : form) }, NAME_CHECK_DEBOUNCE_MS)
    return () => clearTimeout(t)
    // The check depends on the typed name and, before sign-in, on the server details that let it ask.
  }, [checkKey, activated, form.supabaseUrl, form.anonKey, form.licenseKey, form.email, form.password]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!status) return <p className="q3-set__muted" role="status">{error !== '' ? error : 'Loading.'}</p>
  const locked = busy || status.readOnly
  const set = (k: keyof SharedForm) => (e: React.ChangeEvent<HTMLInputElement>): void => {
    const v = k === 'takeover' ? e.target.checked : e.target.value
    setForm((f) => ({ ...f, [k]: v }))
    st.clearMessages()
  }
  const checked = validateSharedForm(form)
  const fieldError = (f: SharedFormField): string | undefined => {
    if (routed?.field === f) return routed.message
    if (touched && !checked.ok) return checked.errors[f]
    return undefined
  }
  const nameNote = nameState === 'taken' ? 'Another branch already uses this name.' : nameStateText(nameState)
  const nameProps = (f: SharedFormField, hint: string): { error: string } | { hint: string } => {
    const e = fieldError(f)
    return e !== undefined ? { error: e } : { hint }
  }
  const submit = async (): Promise<void> => {
    setTouched(true)
    if (!checked.ok || nameState === 'taken' || locked || !status.secretsAvailable) return
    const ok = await st.activate(form)
    if (ok) { setForm({ ...EMPTY_SHARED_FORM, poPrefix: form.poPrefix, device: form.device }); setTouched(false) }
  }
  const closeOff = (): void => { setOffOpen(false); setWord('') }
  const conn = overview.activated || activated
  const renameOk = renameTo.trim() !== '' && nameState !== 'taken' && nameState !== 'checking'

  return (
    <div className="q3-bk" aria-label="Sync sign-in and branches">
      <p className="q3-set__muted">
        Sync is optional. Without it Quot3 works fully on this computer. With it, every branch keeps the same notebook of bills and customers on Supabase; the latest edit wins and the older version is always kept.
      </p>
      {!status.secretsAvailable && <p role="alert" className="q3-set__error">Windows secure storage is not available here, so a login cannot be saved on this computer.</p>}
      {activated ? (
        <>
          <dl className="q3-set__facts" aria-label="Sync sign-in">
            <dt>Status</dt><dd>Signed in{status.activatedAt !== '' ? ` on ${when(status.activatedAt)}` : ''}</dd>
            <dt>Supabase project</dt><dd>{status.host}</dd>
            <dt>License</dt><dd>{status.licenseHint}</dd>
            <dt>Login</dt><dd>{status.emailHint}{status.seatNo !== null ? ` (seat ${status.seatNo})` : ''}</dd>
            <dt>This branch</dt><dd>{status.registered ? `${status.registered.name} (${status.registered.poPrefix})` : ''}</dd>
          </dl>
          <LicenseReveal />
          {branches.length > 0 && (
            <div className="q3-sy__scroll" tabIndex={0} role="region" aria-label="Branches in this notebook">
              <table className="q3-sy__table">
                <thead><tr><th scope="col">Branch</th><th scope="col">PO prefix</th><th scope="col">Computer</th><th scope="col">Last seen</th></tr></thead>
                <tbody>{branches.map((b) => <tr key={b.branchId}><td>{b.name}{b.isThis ? ' (this one)' : ''}</td><td>{b.poPrefix}</td><td>{b.deviceName}</td><td>{when(b.lastSeenAt)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <form className="q3-set__form" aria-label="Rename this branch" onSubmit={(e) => { e.preventDefault(); if (renameOk && !locked) void st.rename(renameTo).then((ok) => { if (ok) setRenameTo('') }) }}>
            <Input ref={renameRef} label="Rename this branch" value={renameTo} autoComplete="off" onChange={(e) => { setRenameTo(e.target.value); st.clearMessages() }}
              {...(routed?.field === 'branchName' ? { error: routed.message } : nameState === 'taken' ? { error: nameNote } : { hint: renameTo.trim() === '' ? 'The name other branches see. It must be different from every other branch.' : nameNote })} />
            <div className="q3-set__row"><Button type="submit" variant="primary" disabled={locked || !renameOk}>Rename</Button></div>
          </form>
          <div className="q3-set__row">
            <Button variant="primary" disabled={locked || !overview.enabled} onClick={() => { void st.compare() }}>Compare and sync</Button>
            <Button variant="ghost" disabled={locked} onClick={() => { void st.load(true) }}>Check connection</Button>
            <Button variant="danger" disabled={locked} onClick={() => { setWord(''); setOffOpen(true) }}>Sign out on this computer</Button>
          </div>
          {compareNote !== '' && <p role="status" className="q3-set__saved">{compareNote}</p>}
          {status.link.state !== 'ok' && status.link.state !== 'unchecked' && status.link.message !== '' && <p role="alert" className="q3-set__error">{status.link.message}</p>}
        </>
      ) : (
        <form className="q3-set__form" aria-label="Sign in to sync" onSubmit={(e) => { e.preventDefault(); void submit() }}>
          <Input label="Supabase project URL" value={form.supabaseUrl} autoComplete="off" spellCheck={false} onChange={set('supabaseUrl')} {...nameProps('supabaseUrl', 'Supabase > Project settings > API > Project URL.')} />
          <Input label="Anon (public) key" value={form.anonKey} autoComplete="off" spellCheck={false} onChange={set('anonKey')} {...nameProps('anonKey', 'The public anon key only. Never paste a service_role key.')} />
          <Input label="License key" value={form.licenseKey} autoComplete="off" spellCheck={false} onChange={set('licenseKey')} {...nameProps('licenseKey', 'Looks like Q3-ABCD-EFGH-JKLM. Shown once when the owner created the license.')} />
          <Input label="Login e-mail" type="email" value={form.email} autoComplete="off" spellCheck={false} onChange={set('email')} {...nameProps('email', 'This computer\'s own login, one per computer.')} />
          <Input label="Login password" type="password" value={form.password} autoComplete="new-password" onChange={set('password')} {...nameProps('password', 'Given with the login. It is kept on this computer only, protected by Windows.')} />
          <Input ref={nameRef} label="Branch name" value={form.branchName} autoComplete="off" onChange={set('branchName')}
            {...(fieldError('branchName') !== undefined ? { error: fieldError('branchName')! } : nameState === 'taken' ? { error: nameNote } : { hint: nameNote !== '' ? nameNote : 'How other branches see this computer, for example Main shop. Must be different on every branch.' })} />
          <Input label="PO prefix" value={form.poPrefix} autoComplete="off" onChange={set('poPrefix')} {...nameProps('poPrefix', 'Starts this branch\'s bill numbers. Must be different on every branch.')} />
          <Input label="This computer's label (optional)" value={form.device} autoComplete="off" onChange={set('device')} hint="Shown in the branch list, for example Counter PC." />
          {(routed?.askTakeover === true || form.takeover) && (
            <div className="q3-set__row">
              <label className="q3-set__check"><input type="checkbox" checked={form.takeover} onChange={set('takeover')} /> Take over this login (this is the same computer, reinstalled)</label>
            </div>
          )}
          {routed?.askTakeover === true && <p role="alert" className="q3-set__error">{routed.message}</p>}
          {routed?.paused === true && <p role="alert" className="q3-set__error">{routed.message}</p>}
          {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
          <div className="q3-set__row"><Button type="submit" variant="primary" disabled={locked || !status.secretsAvailable}>{busy ? 'Signing in' : 'Sign in'}</Button></div>
        </form>
      )}
      {activated && error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
      {activated && routed?.paused === true && <p role="alert" className="q3-set__error">{routed.message}</p>}
      {notice !== '' && <p role="status" className="q3-set__saved">{notice}</p>}
      {!conn && <p className="q3-set__muted">Press Ctrl+K and type "sync" for Sync now and Compare and sync once this computer is signed in.</p>}
      <Dialog open={offOpen} title="Sign out on this computer" onClose={closeOff}
        footer={<><Button variant="ghost" onClick={closeOff}>Cancel</Button><Button variant="danger" disabled={word.trim().toUpperCase() !== DEACTIVATE_WORD || busy} onClick={() => { closeOff(); void st.deactivate() }}>Sign out</Button></>}>
        <p>This forgets the login on this computer. Your bills are not touched, and the branch keeps its seat, so signing in again with the same login costs nothing.</p>
        <Input label={`Type ${DEACTIVATE_WORD} to confirm`} value={word} data-autofocus autoComplete="off" onChange={(e) => setWord(e.target.value)} />
      </Dialog>
    </div>
  )
}
