import { useEffect, useRef, useState } from 'react'
import type { Bill } from '../../../shared/types'
import type { PhoneDb } from '../../data/db'
import { getSetting, setSetting } from '../../data/settingsRepo'
import { browserShareDeps, makeShareFile, type PhoneCompany, type ShareChoice, type ShareEnvDeps, type ShareFileData, type ShareKind, type ShareStyle } from '../../share/shareBill'
import { browserShareEnv, shareFile, type ShareEnv, type ShareResult } from '../../share/shareSheet'

/** The share logic of the classic `SharePanel` (Phase 184), as a hook for the new layouts (Phase 191). Reads the bill, never changes it; the only write
 *  is the remembered choice (`share.defaults`) when the person changes it. `deps` / `env` / `make` are injected by tests. */
export interface UseShareOptions {
  db: PhoneDb
  bill: Bill
  deps?: ShareEnvDeps
  env?: ShareEnv
  make?: (bill: Bill, choice: ShareChoice, company: PhoneCompany | null) => Promise<ShareFileData>
}

export const SHARE_MESSAGES: Record<ShareResult['outcome'], string> = { shared: 'Shared.', cancelled: 'Sharing was cancelled.', downloaded: 'Saved to your downloads (sharing is not available here).' }

export function useShare(o: UseShareOptions): {
  style: ShareStyle; kind: ShareKind; busy: boolean; note: string | null; error: string | null; noCompany: boolean
  pickStyle: (s: ShareStyle) => void; pickKind: (k: ShareKind) => void; go: () => Promise<void>
} {
  const { db, bill } = o
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
      const file = o.make ? await o.make(bill, choice, company) : await makeShareFile(bill, choice, company, o.deps ?? (deps.current ??= browserShareDeps()))
      const r = await shareFile(o.env ?? browserShareEnv(), file.bytes, file.fileName, file.mime, `Quotation ${bill.poNumber}`)
      setNote(SHARE_MESSAGES[r.outcome])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const noCompany = style === 'professional' && (company === null || company.name.trim() === '')
  return { style, kind, busy, note, error, noCompany, pickStyle, pickKind, go }
}
