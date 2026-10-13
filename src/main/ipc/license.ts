import { z } from 'zod'
import type { LicenseService } from '../sync/licenseService'
import { wrapHandler } from './envelope'

const statusIn = z.object({ check: z.boolean().optional() }).strict()
const activateIn = z.object({
  supabaseUrl: z.string().max(300),
  anonKey: z.string().max(2100),
  licenseKey: z.string().max(60),
  passphrase: z.string().max(200)
}).strict()
const deactivateIn = z.object({ confirm: z.string().max(40) }).strict()

/** `license:*` handlers (Phase 52). The renderer never receives the license key, the anon key or the passphrase back. */
export function licenseHandlers(svc: LicenseService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'license:status': wrapHandler(statusIn, (i) => svc.status(i.check === undefined ? {} : { check: i.check })),
    'license:activate': wrapHandler(activateIn, (i) => svc.activate(i)),
    'license:deactivate': wrapHandler(deactivateIn, (i) => svc.deactivate(i))
  }
}
