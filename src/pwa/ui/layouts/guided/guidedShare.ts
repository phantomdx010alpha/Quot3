import type { Bill } from '../../../../shared/types'
import type { PhoneDb } from '../../../data/db'
import { getSetting } from '../../../data/settingsRepo'
import { browserShareDeps, makeShareFile, type PhoneCompany, type ShareChoice, type ShareEnvDeps, type ShareFileData, type ShareKind, type ShareStyle } from '../../../share/shareBill'
import { browserShareEnv, shareFile, type ShareEnv } from '../../../share/shareSheet'
import { SHARE_MESSAGES } from '../../kit/useShare'

/** Test hooks (same idea as `useShare`'s `make` / `env` / `deps`); the app leaves them empty. */
export const shareHooks: { deps?: ShareEnvDeps; env?: ShareEnv; make?: (bill: Bill, choice: ShareChoice, company: PhoneCompany | null) => Promise<ShareFileData> } = {}

let cachedDeps: ShareEnvDeps | null = null

export async function loadShareDefaults(db: PhoneDb): Promise<ShareChoice> {
  try { const d = await getSetting(db, 'share.defaults'); return { style: d.style, kind: d.kind } } catch { return { style: 'professional', kind: 'image' } }
}

export async function hasCompanyName(db: PhoneDb): Promise<boolean> {
  try { const c = await getSetting(db, 'company.profile'); return c !== null && c.name.trim() !== '' } catch { return false }
}

/** Builds the image / PDF of a SAVED bill and opens the phone's share list (the existing share code). Reads the bill, never changes it. Returns the note to show. */
export async function shareBillNow(db: PhoneDb, bill: Bill, style: ShareStyle, kind: ShareKind): Promise<string> {
  let company: PhoneCompany | null = null
  try { company = await getSetting(db, 'company.profile') } catch { /* the page shows a placeholder */ }
  const choice: ShareChoice = { style, kind }
  const file = shareHooks.make ? await shareHooks.make(bill, choice, company) : await makeShareFile(bill, choice, company, shareHooks.deps ?? (cachedDeps ??= browserShareDeps()))
  const r = await shareFile(shareHooks.env ?? browserShareEnv(), file.bytes, file.fileName, file.mime, `Quotation ${bill.poNumber}`)
  return SHARE_MESSAGES[r.outcome]
}
