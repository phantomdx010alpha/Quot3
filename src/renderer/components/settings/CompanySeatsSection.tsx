import { useEffect } from 'react'
import { canOfferLink, seatStatusLine } from '@shared/master/linkForm'
import { Button, Input } from '../ui'
import { useMasterLinkStore } from '../../stores/masterLinkStore'
import { CompanySeatsPanel } from './CompanySeatsPanel'

/**
 * Phase 264 - Settings > Company seats. Every PC sees one status line ("Not linked to master" / "Linked as seat N"). Only seat 1 of a
 * company that is signed in to shared sync, and not linked yet, gets the "Link to master" wizard: enrol token, company name, service_role key
 * (password-style field, cleared the moment the call starts, never stored). The seat list and its actions come in Phases 265-266.
 */
export function CompanySeatsSection(): React.JSX.Element {
  const st = useMasterLinkStore()
  useEffect(() => { void useMasterLinkStore.getState().load() }, [])
  const offer = st.status !== null && canOfferLink({ configured: st.status.configured, linked: st.status.linked, sharedActive: st.sharedActive, sharedSeatNo: st.sharedSeatNo })
  const busy = st.step === 'working'
  return (
    <section className="q3-set__form" aria-label="Company seats">
      <h2 className="q3-set__h">Company seats</h2>
      <p role="status" data-testid="seat-status">{seatStatusLine(st.status)}</p>
      {st.status !== null && !st.status.configured && <p className="q3-set__muted">Company seats are not switched on in this version yet.</p>}
      {st.status?.lastError ? <p role="alert" className="q3-set__error">{st.status.lastError}</p> : null}
      {st.step === 'done' && <p role="status" className="q3-set__saved">{st.message}</p>}
      {offer && st.step === 'idle' && (
        <div className="q3-set__row"><Button variant="primary" onClick={() => st.openWizard()}>Link to master</Button></div>
      )}
      {offer && (st.step === 'form' || st.step === 'working' || st.step === 'failed') && (
        <form className="q3-set__form" aria-label="Link to master" onSubmit={(e) => { e.preventDefault(); void st.submit() }}>
          <p className="q3-set__muted">Seat 1 links the company once. Ask the owner for an enrol token and copy the service_role key from the company project. The key is used for this one step and is not kept.</p>
          <Input label="Enrol token" value={st.enrolToken} autoComplete="off" spellCheck={false} disabled={busy} error={st.fieldErrors.enrolToken} onChange={(e) => st.setField('enrolToken', e.target.value)} />
          <Input label="Company name" value={st.label} autoComplete="off" disabled={busy} error={st.fieldErrors.label} onChange={(e) => st.setField('label', e.target.value)} />
          <Input label="Service role key" type="password" value={st.serviceRoleKey} autoComplete="new-password" spellCheck={false} disabled={busy} error={st.fieldErrors.serviceRoleKey} hint="Supabase > Project settings > API. Never share it." onChange={(e) => st.setField('serviceRoleKey', e.target.value)} />
          {st.step === 'failed' && <p role="alert" className="q3-set__error">{st.message}</p>}
          <div className="q3-set__row">
            <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Linking...' : 'Link company'}</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => st.closeWizard()}>Cancel</Button>
          </div>
        </form>
      )}
      {st.status?.linked === true && st.status.isAdmin && <CompanySeatsPanel />}
    </section>
  )
}
