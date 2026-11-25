import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { UserCircle } from '@phosphor-icons/react'
import type { PhoneDb } from '../data/db'
import type { StorageEnv } from '../platform/storage'
import { loadProfileInput, type ProfileEngine } from './loadProfile'
import { buildProfile, diagnosticsText, type ProfileInput } from './profileModel'
import { useSeatRights } from './useSeatRights'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Phase 295: the phone Profile page. READ ONLY: it edits nothing; the only controls are two links and one copy button.
 *  Works offline (it reads the phone only) and in every new layout (plain `q3-*` classes, no layout CSS). */
export function ProfilePage(props: {
  db: PhoneDb | null; version: string; engine?: ProfileEngine | null; storageEnv?: StorageEnv
  onOpenCompany?: () => void; onOpenPayments?: () => void
}): ReactElement {
  const { db } = props
  const { flags, source, checkedAt } = useSeatRights()
  const [input, setInput] = useState<ProfileInput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (!db) return undefined
    let off = false
    loadProfileInput(db, { version: props.version, engine: props.engine, storageEnv: props.storageEnv, rights: { flags, source, checkedAt } }).then(
      (v) => { if (!off) setInput(v) },
      (e: unknown) => { if (!off) setError(msg(e)) }
    )
    return () => { off = true }
  }, [db, props.version, props.engine, props.storageEnv, flags, source, checkedAt])

  const view = useMemo(() => (input ? buildProfile(input) : null), [input])

  if (!db) return <p className="q3-note q3-note-warn" role="alert">Your data could not be opened, so the profile is unavailable.</p>
  if (error) return <p className="q3-note q3-note-warn" role="alert">{error}</p>
  if (!view) return <p className="q3-muted" role="status">Loading</p>

  const copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(diagnosticsText(view)); setNote('Copied. No codes, passwords or bank details are included.') } catch { setNote('Could not copy on this phone.') }
  }
  const open = (id: 'company' | 'payments'): void => { if (id === 'company') props.onOpenCompany?.(); else props.onOpenPayments?.() }

  return (
    <section className="q3-profile" aria-label="Profile" data-testid="profile-page">
      {view.groups.map((g) => (
        <section key={g.id} className="q3-set" aria-label={g.title} data-testid={`profile-${g.id}`}>
          <h2 className="q3-h2">{g.title}</h2>
          {g.rows.map((r) => <div key={r.label} className="q3-row"><span>{r.label}</span><span>{r.value}</span></div>)}
          {g.note ? <p className="q3-muted">{g.note}</p> : null}
          {g.link && ((g.link.id === 'company' && props.onOpenCompany) || (g.link.id === 'payments' && props.onOpenPayments)) ? (
            <div className="q3-actions"><button type="button" className="q3-btn" onClick={() => open(g.link!.id)}>{g.link.label}</button></div>
          ) : null}
          {g.id === 'help' ? (
            <div className="q3-actions"><button type="button" className="q3-btn" onClick={() => void copy()}>Copy diagnostics</button></div>
          ) : null}
        </section>
      ))}
      {note ? <p className="q3-note" role="status">{note}</p> : null}
    </section>
  )
}

/** The Dashboard entry (the \"name line\"): one calm button on each new layout's Home. */
export function ProfileEntry(props: { onOpen: () => void }): ReactElement {
  return (
    <button type="button" className="q3x-pl-entry" data-testid="profile-entry" onClick={props.onOpen}>
      <UserCircle size={24} weight="light" aria-hidden="true" />
      <span className="q3x-pl-entry-label">Profile</span>
    </button>
  )
}
