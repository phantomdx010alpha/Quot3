/**
 * Phase 272 (M24, API_CONTRACTS.md M24-R) - the company profile on the phone.
 * The phone only DISPLAYS the company default [A]: there is no override editor. The default is kept in the phone's `settings` store under
 * `company.master` (IndexedDB, no schema change, kept in the backup file like the other non-secret settings). `effectiveCompany` is the single reader
 * every share / bill output uses: the company default when one was downloaded, else the phone's own `company.profile` exactly as before.
 * `refreshCompanyProfile` asks the master (`heartbeat`, then `profile-get` only when the version moved); it never throws and never blocks sync.
 */
import { getSetting, setSetting, type SettingDefaults } from '../data/settingsRepo'
import type { PhoneDb } from '../data/db'
import type { ProfileView } from '../../shared/master/schemas'
import type { PhoneMasterClient } from './master'
import type { SessionVault } from './session'

export type CompanyBlock = SettingDefaults['company.profile']
export type MasterProfileStored = NonNullable<SettingDefaults['company.master']>

/** Master profile -> what the phone keeps (logo: base64 PNG -> data URL, null when none). */
export function storedFromProfile(p: ProfileView): MasterProfileStored {
  return { version: p.version, name: p.name, phone: p.phone, address: p.address, logoDataUrl: p.logo ? `data:image/png;base64,${p.logo}` : null }
}

/** Pure: the company default when it has a name, else the phone's own record (nothing changes for a phone that is not linked). */
export function pickCompany(master: SettingDefaults['company.master'], local: CompanyBlock): CompanyBlock {
  if (!master || master.name.trim() === '') return local
  return { name: master.name, phone: master.phone, address: master.address, logoDataUrl: master.logoDataUrl }
}

/** The single reader of the company block for share / bill output. A read failure falls back to the phone's own record. */
export async function effectiveCompany(db: PhoneDb): Promise<CompanyBlock> {
  const local = await getSetting(db, 'company.profile')
  try { return pickCompany(await getSetting(db, 'company.master'), local) } catch { return local }
}

/** Stores a downloaded default; an older (or equal) version than the stored one is ignored. Returns true when stored. */
export async function storeMasterProfile(db: PhoneDb, p: ProfileView): Promise<boolean> {
  const cur = await getSetting(db, 'company.master')
  if (cur && cur.version >= p.version) return false
  await setSetting(db, 'company.master', storedFromProfile(p))
  return true
}

export interface ProfileRefreshDeps { db: PhoneDb; vault: Pick<SessionVault, 'load'>; master: PhoneMasterClient; nowMs?: () => number }

/** Throttle: one master call per this many ms per runtime (a sync cycle may run every few seconds). */
export const PROFILE_REFRESH_GAP_MS = 10 * 60_000

export function createProfileRefresher(deps: ProfileRefreshDeps): { refresh(force?: boolean): Promise<'updated' | 'same' | 'skipped' | 'failed'> } {
  const now = deps.nowMs ?? Date.now
  let last = -Infinity
  return {
    async refresh(force = false) {
      try {
        if (!deps.master.configured()) return 'skipped'
        if (!force && now() - last < PROFILE_REFRESH_GAP_MS) return 'skipped'
        const token = (await deps.vault.load())?.deviceToken
        if (!token) return 'skipped'
        last = now()
        const cur = await getSetting(deps.db, 'company.master')
        const hb = await deps.master.heartbeat({ profileVersion: cur ? cur.version : null }, token)
        if (!hb.profileChanged) return 'same'
        const p = await deps.master.profileGet(token)
        return (await storeMasterProfile(deps.db, p)) ? 'updated' : 'same'
      } catch { return 'failed' } // offline / master down: the last downloaded default stays
    }
  }
}
