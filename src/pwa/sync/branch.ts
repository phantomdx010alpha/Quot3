import { SERVER_PREFIX_RE, checkPrefixForServer, validateBranchName, validateEmail, validateLicenseKey, validateSeatPassword, validateSupabaseUrl, validateAnonKey } from '../../shared/sync/license'
import { branchNameKey } from '../../shared/sync/sharedUi'
import type { PhoneDb } from '../data/db'
import { txDone } from '../data/db'
import { getMeta, getMetaValue } from '../data/metaRepo'
import { PhoneSyncError, toSyncFailure } from './errors'
import { refreshClockOffset } from './clock'
import { persistSessionChanges, signOutPhone, VaultError, type SessionVault } from './session'
import type { PhoneSyncPort, SyncFailure } from './transport'

/** Phase 178 - make this phone its OWN seat and branch (spec section 4; design [A] 1: unconfirmed). */

export interface LinkInput {
  supabaseUrl: string
  anonKey: string
  licenseKey: string
  email: string
  password: string
  branchName: string
  poPrefix: string
  /** Shown in the branch list on other computers, e.g. "Android phone". */
  device?: string
  /** Only when the person ticked "take over this login" (the same seat used by an older install). Default false. */
  takeover?: boolean
}

export type LinkField = 'supabaseUrl' | 'anonKey' | 'licenseKey' | 'email' | 'password' | 'branchName' | 'poPrefix'
export type LinkFieldErrors = Partial<Record<LinkField, string>>

export interface CleanLinkInput extends Required<Omit<LinkInput, 'takeover' | 'device'>> { device: string; takeover: boolean }

/** Checks the shape of every field (the server decides whether they are right). Pure. */
export function validateLinkInput(i: LinkInput): { ok: true; value: CleanLinkInput } | { ok: false; errors: LinkFieldErrors } {
  const errors: LinkFieldErrors = {}
  const url = validateSupabaseUrl(i.supabaseUrl)
  const key = validateAnonKey(i.anonKey)
  const lic = validateLicenseKey(i.licenseKey)
  const mail = validateEmail(i.email)
  const pw = validateSeatPassword(i.password)
  const name = validateBranchName(i.branchName)
  const prefix = checkPrefixForServer(i.poPrefix)
  if (!url.ok) errors.supabaseUrl = url.message
  if (!key.ok) errors.anonKey = key.message
  if (!lic.ok) errors.licenseKey = lic.message
  if (!mail.ok) errors.email = mail.message
  if (!pw.ok) errors.password = pw.message
  if (!name.ok) errors.branchName = name.message
  if (!prefix.ok) errors.poPrefix = 'The PO prefix can use letters, digits and - _ / only, up to 8 characters.'
  if (!url.ok || !key.ok || !lic.ok || !mail.ok || !pw.ok || !name.ok || !prefix.ok) return { ok: false, errors }
  return {
    ok: true,
    value: {
      supabaseUrl: url.value, anonKey: key.value, licenseKey: lic.value, email: mail.value, password: pw.value, branchName: name.value, poPrefix: prefix.value,
      device: (i.device ?? 'Phone').trim().slice(0, 80) || 'Phone', takeover: i.takeover === true
    }
  }
}

export type LinkResult =
  | { ok: true; orgId: string; branchId: string; branchName: string; poPrefix: string; seatNo: number; clockOffsetMs: number | null; branches: { branchId: string; name: string; poPrefix: string }[] }
  | { ok: false; code: 'VALIDATION'; errors: LinkFieldErrors }
  | { ok: false; code: 'PREFIX_LOCKED'; message: string; errors: LinkFieldErrors }
  | { ok: false; code: 'SYNC'; failure: SyncFailure; errors: LinkFieldErrors }
  | { ok: false; code: 'STORAGE'; message: string }
  | { ok: false; code: 'ORG_MISMATCH'; message: string }

/** The field a server refusal belongs to, so the form can mark it. */
function fieldFor(kind: SyncFailure['kind']): LinkField | null {
  switch (kind) {
    case 'name_taken': return 'branchName'
    case 'prefix_taken': return 'poPrefix'
    case 'auth_failed': case 'not_member': return 'password'
    case 'license': return 'licenseKey'
    case 'anon_key': return 'anonKey'
    default: return null
  }
}

async function newBranchId(db: PhoneDb): Promise<string> {
  const existing = await getMetaValue(db, 'branch_id')
  return existing ?? crypto.randomUUID()
}

/**
 * Sign in as the seat, check the branch name, register this phone as a branch, then store org / branch / prefix in ONE transaction.
 * - The `branch_id` is made once and reused on every retry, so a half-finished attempt never leaves two branches.
 * - Once bills exist (`po_counter` > 0) the PO prefix is locked: changing it would make old and new PO numbers disagree.
 * - Nothing is stored in `meta` unless the server accepted the branch. A refused name or prefix leaves the phone exactly as it was.
 * - The password is used for this call only and never stored.
 */
export async function linkPhoneToOrganisation(db: PhoneDb, port: PhoneSyncPort, vault: SessionVault, input: LinkInput, nowMs: () => number = Date.now): Promise<LinkResult> {
  const checked = validateLinkInput(input)
  if (!checked.ok) return { ok: false, code: 'VALIDATION', errors: checked.errors }
  const c = checked.value

  const meta = await getMeta(db)
  if (meta.po_counter > 0 && meta.po_prefix !== null && meta.po_prefix !== c.poPrefix) {
    return {
      ok: false, code: 'PREFIX_LOCKED', errors: { poPrefix: `This phone already issued PO numbers with ${meta.po_prefix}. The prefix cannot change now.` },
      message: `This phone already issued PO numbers with ${meta.po_prefix}. The prefix cannot change now.`
    }
  }

  const branchId = await newBranchId(db)
  let stopPersist: (() => void) | null = null
  try {
    const session = await port.signIn({ email: c.email, password: c.password })
    // Save the login first (refresh tokens are single-use), then watch for refreshes.
    await vault.save({ supabaseUrl: c.supabaseUrl, anonKey: c.anonKey, license: c.licenseKey, email: c.email, session })
    stopPersist = persistSessionChanges(port, vault)

    const free = await port.branchNameFree({ license: c.licenseKey, name: c.branchName, branchId })
    if (!free) throw new PhoneSyncError('name_taken')

    const res = await port.activate({ license: c.licenseKey, branchId, name: c.branchName, poPrefix: c.poPrefix, device: c.device, takeover: c.takeover })

    if (meta.org_id !== null && meta.org_id !== res.orgId) {
      await signOutPhone(vault, port)
      return { ok: false, code: 'ORG_MISMATCH', message: 'This phone already holds bills of a different organisation. Reset the phone data first, then link it again.' }
    }
    await putMetaTogether(db, { org_id: res.orgId, branch_id: branchId, branch_name: c.branchName, po_prefix: c.poPrefix })

    let clockOffsetMs: number | null = null
    try {
      clockOffsetMs = await refreshClockOffset(db, port, nowMs)
    } catch {
      clockOffsetMs = null // not fatal: Phase 179 measures again before it pushes
    }
    return { ok: true, orgId: res.orgId, branchId, branchName: c.branchName, poPrefix: c.poPrefix, seatNo: res.seatNo, clockOffsetMs, branches: res.branches }
  } catch (e) {
    if (e instanceof VaultError) return { ok: false, code: 'STORAGE', message: e.message }
    const failure = toSyncFailure(e)
    // A failed attempt must not leave a half-trusted login behind: a refused name / prefix / password signs the phone out again.
    if (failure.kind !== 'offline' && failure.kind !== 'timeout') await signOutPhone(vault, port).catch(() => undefined)
    const f = fieldFor(failure.kind)
    return { ok: false, code: 'SYNC', failure, errors: f ? { [f]: failure.message } : {} }
  } finally {
    // The session listener only needs to live during linking; the app attaches its own long-lived one at start (Phase 179).
    stopPersist?.()
  }
}

/** Writes several meta keys in ONE transaction so org, branch and prefix always change together. */
async function putMetaTogether(db: PhoneDb, values: Record<string, unknown>): Promise<void> {
  db.assertWritable()
  const tx = db.idb.transaction('meta', 'readwrite')
  const store = tx.objectStore('meta')
  for (const [key, value] of Object.entries(values)) store.put({ key, value })
  await txDone(tx)
}

export interface BranchLink {
  linked: boolean
  orgId: string | null
  branchId: string | null
  branchName: string | null
  poPrefix: string | null
}

/** What the phone knows about its own branch, for Settings and the sync status line. */
export async function getBranchLink(db: PhoneDb): Promise<BranchLink> {
  const m = await getMeta(db)
  return { linked: m.org_id !== null && m.branch_id !== null && m.po_prefix !== null, orgId: m.org_id, branchId: m.branch_id, branchName: m.branch_name, poPrefix: m.po_prefix }
}

/** Debounce-friendly name check for the form: true = free. Offline / paused is reported as `unknown` (null) so the form does not block typing. */
export async function checkBranchNameFree(db: PhoneDb, port: PhoneSyncPort, license: string, name: string): Promise<boolean | null> {
  const n = validateBranchName(name)
  const lic = validateLicenseKey(license)
  if (!n.ok || !lic.ok) return null
  try {
    const branchId = (await getMetaValue(db, 'branch_id')) ?? undefined
    return await port.branchNameFree({ license: lic.value, name: n.value, branchId })
  } catch {
    return null
  }
}

export { branchNameKey, SERVER_PREFIX_RE }
