import { z } from 'zod'
import type { SharedSyncService } from '../sync/sharedSyncService'
import { wrapHandler } from './envelope'

const none = z.object({}).strict()
const statusIn = z.object({ check: z.boolean().optional() }).strict()
const signInFields = {
  supabaseUrl: z.string().max(300),
  anonKey: z.string().max(2100),
  licenseKey: z.string().max(60),
  email: z.string().max(320),
  password: z.string().max(200)
}
const activateIn = z.object({
  ...signInFields,
  branchName: z.string().max(200),
  poPrefix: z.string().max(20),
  device: z.string().max(200).optional(),
  takeover: z.boolean().optional()
}).strict()
const deactivateIn = z.object({ confirm: z.string().max(40) }).strict()
const nameIn = z.object({ name: z.string().max(200), signIn: z.object(signInFields).strict().optional() }).strict()
const renameIn = z.object({ name: z.string().max(200) }).strict()

/**
 * `syncShared:*` handlers (Phase 140b; the contract is `SharedSyncBridge`). The renderer gets masked hints and counts only: never the
 * anon key, password or a token. The ONE exception (0.1.31) is `syncShared:revealLicense`: the owner clicks "Show license key" and the
 * stored key comes back once, so a lost key can be read from a computer that is already signed in. A transport failure carries its kind in `details.kind` (the preload turns it into `error.kind`).
 */
export function syncSharedHandlers(svc: SharedSyncService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'syncShared:status': wrapHandler(statusIn, (i) => svc.status(i.check === undefined ? {} : { check: i.check })),
    'syncShared:activate': wrapHandler(activateIn, (i) => svc.activate({
      supabaseUrl: i.supabaseUrl, anonKey: i.anonKey, licenseKey: i.licenseKey, email: i.email, password: i.password, branchName: i.branchName, poPrefix: i.poPrefix,
      ...(i.device !== undefined ? { device: i.device } : {}), ...(i.takeover !== undefined ? { takeover: i.takeover } : {})
    })),
    'syncShared:deactivate': wrapHandler(deactivateIn, (i) => svc.deactivate(i)),
    'syncShared:branchNameFree': wrapHandler(nameIn, (i) => svc.nameFree(i.signIn ? { name: i.name, signIn: i.signIn } : { name: i.name })),
    'syncShared:renameBranch': wrapHandler(renameIn, (i) => svc.rename(i)),
    'syncShared:listBranches': wrapHandler(none, () => svc.list()),
    'syncShared:compare': wrapHandler(none, () => svc.compare()),
    'syncShared:revealLicense': wrapHandler(none, () => svc.revealLicense())
  }
}
