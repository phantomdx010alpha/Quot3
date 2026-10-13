import { useEffect, useState } from 'react'
import { DEACTIVATE_WORD, validateAnonKey, validateLicenseKey, validatePassphrase, validateSupabaseUrl, type LinkState } from '@shared/sync/license'
import { Button, Dialog, Input } from '../ui'
import { useLicenseStore } from '../../stores/licenseStore'
import { hasSharedBridge } from '../../stores/sharedSyncStore'
import { SharedSyncSection } from './SharedSyncSection'
import { CutoverWizard, hasCutoverBridge } from './CutoverWizard'

const LINK_TEXT: Record<LinkState, string> = {
  unchecked: 'Not checked yet',
  ok: 'Connected',
  offline: 'Offline',
  license_problem: 'License problem',
  server_problem: 'Supabase problem'
}
const when = (iso: string): string => {
  const d = new Date(iso)
  return iso === '' || Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * Phase 52 - license activation. Sync is optional and stays off until a license is activated here. The Supabase address and
 * anon (public) key come from the owner's project; the license key and the organisation passphrase are typed once and are not
 * shown again. Phase 59 adds the sync switch and status.
 */
export function LegacySyncSection(): React.JSX.Element {
  const { status, busy, error, notice } = useLicenseStore()
  const [url, setUrl] = useState('')
  const [anon, setAnon] = useState('')
  const [key, setKey] = useState('')
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [touched, setTouched] = useState(false)
  const [offOpen, setOffOpen] = useState(false)
  const [word, setWord] = useState('')
  useEffect(() => { void useLicenseStore.getState().load() }, [])

  if (!status) return <p className="q3-set__muted" role="status">{error !== '' ? error : 'Loading.'}</p>
  const on = status.state === 'activated'
  const locked = busy || status.readOnly

  const uc = validateSupabaseUrl(url), ac = validateAnonKey(anon), kc = validateLicenseKey(key), pc = validatePassphrase(pass)
  const mismatch = pass !== pass2
  const msg = (c: { ok: boolean; message?: string }): string | undefined => (touched && !c.ok ? c.message : undefined)
  const canSubmit = uc.ok && ac.ok && kc.ok && pc.ok && !mismatch && status.secretsAvailable && !locked

  const submit = async (): Promise<void> => {
    setTouched(true)
    if (!canSubmit) return
    const ok = await useLicenseStore.getState().activate({ supabaseUrl: url, anonKey: anon, licenseKey: key, passphrase: pass })
    if (ok) { setKey(''); setPass(''); setPass2(''); setAnon(''); setTouched(false) }
  }
  const closeOff = (): void => { setOffOpen(false); setWord('') }

  return (
    <div className="q3-bk" aria-label="Sync and license">
      <p className="q3-set__muted">
        Sync is optional. Without it Quot3 works fully on this computer. With a license, branches pass encrypted bills to each other through Supabase, which never holds readable bill data.
      </p>
      {!status.secretsAvailable && <p role="alert" className="q3-set__error">Windows secure storage is not available here, so a license cannot be saved on this computer.</p>}
      {on ? (
        <>
          <dl className="q3-set__facts" aria-label="License status">
            <dt>Status</dt><dd>Activated{status.activatedAt !== '' ? ` on ${when(status.activatedAt)}` : ''}</dd>
            <dt>Supabase project</dt><dd>{status.host}</dd>
            <dt>License</dt><dd>{status.licenseHint}</dd>
            <dt>This branch</dt><dd>{status.registered ? `${status.registered.name} (${status.registered.poPrefix})` : ''}</dd>
            <dt>Connection</dt><dd role="status">{LINK_TEXT[status.link.state]}{status.link.at !== '' ? `, ${when(status.link.at)}` : ''}{status.link.message !== '' && status.link.state !== 'ok' ? `. ${status.link.message}` : ''}</dd>
            <dt>Encryption key</dt><dd>{status.passphraseSaved ? 'Ready on this computer (the passphrase itself is not stored)' : 'Missing - deactivate and activate again'}</dd>
          </dl>
          {!status.prefixInSync && status.local && (
            <p role="alert" className="q3-set__error">The PO prefix here is now {status.local.poPrefix}, but the license has {status.registered?.poPrefix}. Deactivate and activate again to register the new prefix.</p>
          )}
          {status.branches.length > 0 && (
            <div className="q3-sy__scroll" tabIndex={0} role="region" aria-label="Branches in this license">
              <table className="q3-sy__table">
                <thead><tr><th scope="col">Branch</th><th scope="col">PO prefix</th></tr></thead>
                <tbody>{status.branches.map((b) => <tr key={b.branchId}><td>{b.name}{b.branchId === status.registered?.branchId ? ' (this one)' : ''}</td><td>{b.poPrefix}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <div className="q3-set__row">
            <Button variant="primary" disabled={busy || status.readOnly} onClick={() => { void useLicenseStore.getState().load(true) }}>Check connection</Button>
            <Button variant="danger" disabled={locked} onClick={() => { setWord(''); setOffOpen(true) }}>Deactivate on this computer</Button>
          </div>
        </>
      ) : (
        <form className="q3-set__form" aria-label="Activate a license" onSubmit={(e) => { e.preventDefault(); void submit() }}>
          <Input label="Supabase project URL" value={url} autoComplete="off" spellCheck={false} onChange={(e) => { setUrl(e.target.value); useLicenseStore.getState().clearMessages() }} {...(msg(uc) ? { error: msg(uc)! } : { hint: 'Supabase > Project settings > API > Project URL.' })} />
          <Input label="Anon (public) key" value={anon} autoComplete="off" spellCheck={false} onChange={(e) => { setAnon(e.target.value); useLicenseStore.getState().clearMessages() }} {...(msg(ac) ? { error: msg(ac)! } : { hint: 'The public anon key only. Never paste a service_role key.' })} />
          <Input label="License key" value={key} autoComplete="off" spellCheck={false} onChange={(e) => { setKey(e.target.value); useLicenseStore.getState().clearMessages() }} {...(msg(kc) ? { error: msg(kc)! } : { hint: 'Looks like Q3-ABCD-EFGH-JKLM.' })} />
          <Input label="Organisation passphrase" type="password" value={pass} autoComplete="new-password" onChange={(e) => { setPass(e.target.value); useLicenseStore.getState().clearMessages() }} {...(msg(pc) ? { error: msg(pc)! } : { hint: 'Chosen by the owner. Every branch must use the same one. It never leaves your computers, and nobody can recover it for you.' })} />
          <Input label="Passphrase again" type="password" value={pass2} autoComplete="new-password" onChange={(e) => setPass2(e.target.value)} {...(touched && mismatch ? { error: 'The two passphrases are different.' } : {})} />
          {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
          <div className="q3-set__row"><Button type="submit" variant="primary" disabled={locked || !status.secretsAvailable}>{busy ? 'Activating' : 'Activate'}</Button></div>
        </form>
      )}
      {on && error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
      {notice !== '' && <p role="status" className="q3-set__saved">{notice}</p>}
      <Dialog open={offOpen} title="Deactivate on this computer" onClose={closeOff}
        footer={<><Button variant="ghost" onClick={closeOff}>Cancel</Button><Button variant="danger" disabled={word.trim().toUpperCase() !== DEACTIVATE_WORD || busy} onClick={() => { closeOff(); void useLicenseStore.getState().deactivate(DEACTIVATE_WORD) }}>Deactivate</Button></>}>
        <p>This forgets the license and passphrase on this computer. Your bills are not touched and the license keeps this branch's seat, so activating again with the same key costs nothing.</p>
        <Input label={`Type ${DEACTIVATE_WORD} to confirm`} value={word} data-autofocus autoComplete="off" onChange={(e) => setWord(e.target.value)} />
      </Dialog>
    </div>
  )
}

/**
 * Phase 139: the Sync section. When the app offers the shared-notebook bridge (wired in Phase 140) the new sign-in screen is
 * shown (e-mail + password, branch name, no passphrase); until then the v1 license screen above stays, so a computer that is
 * already activated keeps showing its state. Phase 142 removes the v1 screen.
 */
export function SyncSection(): React.JSX.Element {
  if (!hasSharedBridge()) return <LegacySyncSection />
  // Phase 140: a computer that still has the old sync gets the cutover wizard first; everyone else goes straight to the new screen.
  return hasCutoverBridge() ? <CutoverWizard /> : <SharedSyncSection />
}
