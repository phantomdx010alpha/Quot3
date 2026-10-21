import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { Bill } from '../../shared/types'
import type { PhoneDb } from '../data/db'
import { getSetting, setSetting } from '../data/settingsRepo'
import { browserShareDeps, makeShareFile, type PhoneCompany, type ShareChoice, type ShareEnvDeps, type ShareFileData, type ShareKind, type ShareStyle } from '../share/shareBill'
import { browserShareEnv, shareFile, type ShareEnv, type ShareResult } from '../share/shareSheet'

/** Share image / Share PDF for a saved bill (Phase 184). The only output on the phone: no print, no clipboard image. Sharing never changes the bill.
 *  The last choice is remembered ([A] unconfirmed: Rough / Professional and image / PDF). `deps` / `env` are injected by tests. */
export interface SharePanelProps {
  db: PhoneDb
  bill: Bill
  deps?: ShareEnvDeps
  env?: ShareEnv
  /** Tests: replaces the render step. */
  make?: (bill: Bill, choice: ShareChoice, company: PhoneCompany | null) => Promise<ShareFileData>
}

const MESSAGES: Record<ShareResult['outcome'], string> = { shared: 'Shared.', cancelled: 'Sharing was cancelled.', downloaded: 'Saved to your downloads (sharing is not available here).' }

export function SharePanel(props: SharePanelProps): ReactElement {
  const { db, bill } = props
  const [style, setStyle] = useState<ShareStyle>('professional')
  const [kind, setKind] = useState<ShareKind>('image')
  const [company, setCompany] = useState<PhoneCompany | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const deps = useRef<ShareEnvDeps | null>(null)

  useEffect(() => {
    let off = false
    void (async () => {
      try {
        const d = await getSetting(db, 'share.defaults')
        const c = await getSetting(db, 'company.profile')
        if (off) return
        setStyle(d.style); setKind(d.kind); setCompany(c)
      } catch { /* defaults stay */ }
    })()
    return () => { off = true }
  }, [db])

  const remember = (s: ShareStyle, k: ShareKind): void => {
    if (db.canWrite()) void setSetting(db, 'share.defaults', { style: s, kind: k }).catch(() => undefined)
  }
  const pickStyle = (s: ShareStyle): void => { setStyle(s); remember(s, kind) }
  const pickKind = (k: ShareKind): void => { setKind(k); remember(style, k) }

  const go = async (): Promise<void> => {
    setBusy(true); setNote(null); setError(null)
    try {
      const choice: ShareChoice = { style, kind }
      const file = props.make
        ? await props.make(bill, choice, company)
        : await makeShareFile(bill, choice, company, props.deps ?? (deps.current ??= browserShareDeps()))
      const r = await shareFile(props.env ?? browserShareEnv(), file.bytes, file.fileName, file.mime, `Quotation ${bill.poNumber}`)
      setNote(MESSAGES[r.outcome])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const noCompany = style === 'professional' && (company === null || company.name.trim() === '')
  return (
    <section className="q3-share" aria-label="Share">
      <div className="q3-chips" role="group" aria-label="Style">
        <button type="button" className="q3-chip" aria-pressed={style === 'rough'} onClick={() => pickStyle('rough')}>Rough</button>
        <button type="button" className="q3-chip" aria-pressed={style === 'professional'} onClick={() => pickStyle('professional')}>Professional</button>
      </div>
      <div className="q3-chips" role="group" aria-label="Format">
        <button type="button" className="q3-chip" aria-pressed={kind === 'image'} onClick={() => pickKind('image')}>Image</button>
        <button type="button" className="q3-chip" aria-pressed={kind === 'pdf'} onClick={() => pickKind('pdf')}>PDF</button>
      </div>
      {noCompany ? <p className="q3-note" role="note">No company name yet: the page shows a placeholder. Add yours in Settings.</p> : null}
      <button type="button" className="q3-btn q3-btn-primary" disabled={busy} onClick={() => void go()}>{busy ? 'Preparing' : kind === 'image' ? 'Share image' : 'Share PDF'}</button>
      {note ? <p className="q3-muted" role="status">{note}</p> : null}
      {error ? <p className="q3-note q3-note-warn" role="alert">{error}</p> : null}
    </section>
  )
}
