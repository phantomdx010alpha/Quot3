import type { SyncStateRepo } from '../db/syncStateRepo'
import { AppError } from '../ipc/envelope'
import type { Logger } from '../logger'
import {
  validateAnonKey, validateBranchName, validateEmail, validateLicenseKey, validateSeatPassword, validateSupabaseUrl,
  type Checked, type RegisteredBranch, type SharedLicenseStatus
} from '../../shared/sync/license'
import type { BranchRowUi } from '../../shared/sync/sharedUi'
import { SHARED_KEYS, sharedToAppError, type SharedActivation } from './activationV2'
import type { SharedStoreTransport } from './sharedTransport'

/**
 * Phase 140b - the three branch calls of Settings > Sync that the activation service does not own: "is this name free?", rename, and the
 * branch list. They go through the same signed-in transport as the workers (`activation.connect()`); before activation the typed
 * details sign in once for the name check and sign out again. Nothing secret is logged or returned.
 */
export interface SharedBranchesService {
  nameFree(input: { name: string; signIn?: { supabaseUrl: string; anonKey: string; licenseKey: string; email: string; password: string } }): Promise<{ free: boolean }>
  rename(input: { name: string }): Promise<SharedLicenseStatus>
  list(): Promise<BranchRowUi[]>
}

export interface SharedBranchesDeps {
  activation: SharedActivation
  sync: Pick<SyncStateRepo, 'get' | 'set'>
  makeTransport: (cfg: { url: string; anonKey: string }) => SharedStoreTransport
  log: Pick<Logger, 'info' | 'warn' | 'error'>
}

const need = <T>(c: Checked<T>): T => { if (!c.ok) throw new AppError('VALIDATION', c.message); return c.value }
const json = <T>(raw: string | undefined, fallback: T): T => { if (raw === undefined) return fallback; try { return JSON.parse(raw) as T } catch { return fallback } }

export function createSharedBranches(deps: SharedBranchesDeps): SharedBranchesService {
  const { activation, sync } = deps
  return {
    async nameFree({ name, signIn }) {
      const clean = need(validateBranchName(name))
      try {
        if (signIn) {
          const url = need(validateSupabaseUrl(signIn.supabaseUrl))
          const anonKey = need(validateAnonKey(signIn.anonKey))
          const license = need(validateLicenseKey(signIn.licenseKey))
          const email = need(validateEmail(signIn.email))
          const password = need(validateSeatPassword(signIn.password))
          const t = deps.makeTransport({ url, anonKey })
          try {
            await t.signIn({ email, password })
            return { free: await t.branchNameFree({ license, name: clean }) }
          } finally { await t.signOut().catch(() => undefined) }
        }
        const { transport, creds } = await activation.connect()
        return { free: await transport.branchNameFree({ license: creds.license, name: clean, branchId: creds.branchId }) }
      } catch (e) { throw sharedToAppError(e) }
    },

    async rename({ name }) {
      const clean = need(validateBranchName(name))
      try {
        const { transport, creds } = await activation.connect()
        const r = await transport.renameBranch({ license: creds.license, branchId: creds.branchId, name: clean })
        const reg = json<RegisteredBranch | null>(sync.get(SHARED_KEYS.registeredBranch), null)
        if (reg) sync.set(SHARED_KEYS.registeredBranch, JSON.stringify({ ...reg, name: r.name }))
        const list = json<RegisteredBranch[]>(sync.get(SHARED_KEYS.branches), [])
        sync.set(SHARED_KEYS.branches, JSON.stringify(list.map((b) => (b.branchId === r.branchId ? { ...b, name: r.name } : b))))
        deps.log.info('Branch renamed in the shared notebook')
      } catch (e) { throw sharedToAppError(e) }
      return activation.status()
    },

    async list() {
      try {
        const { transport, creds } = await activation.connect()
        const rows = await transport.listBranches({ license: creds.license, branchId: creds.branchId })
        sync.set(SHARED_KEYS.branches, JSON.stringify(rows.map(({ branchId, name, poPrefix }) => ({ branchId, name, poPrefix }))))
        return rows.map((b): BranchRowUi => ({ branchId: b.branchId, name: b.name, poPrefix: b.poPrefix, deviceName: b.deviceName, lastSeenAt: b.lastSeenAt, isThis: b.branchId === creds.branchId }))
      } catch (e) { throw sharedToAppError(e) }
    }
  }
}
