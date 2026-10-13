import { z } from 'zod'
import { checkSchema, setBusySchema, UPDATE_FEED_MAX } from '../../shared/updater'
import { chooseVersionSchema, listVersionsSchema } from '../../shared/rollback'
import type { UpdateService } from '../services/updateService'
import { wrapHandler } from './envelope'

const configSchema = z.object({
  auto: z.boolean().optional(),
  channel: z.enum(['stable', 'beta']).optional(),
  feedUrl: z.string().max(UPDATE_FEED_MAX).optional()
}).strict()

/** `updates:*` (Phase 62). `install` is refused in the service while an unsaved bill is open or nothing is downloaded. */
export function updateHandlers(updates: UpdateService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'updates:state': wrapHandler(checkSchema, () => updates.state()),
    'updates:check': wrapHandler(checkSchema, () => updates.check(true)),
    'updates:install': wrapHandler(checkSchema, () => { updates.install(); return {} }),
    'updates:setBusy': wrapHandler(setBusySchema, (i) => { updates.setBusy(i.busy); return {} }),
    'updates:setConfig': wrapHandler(configSchema, (i) => updates.setConfig(i)),
    // 0.1.5 "choose app version": the list comes from GitHub (main only), a chosen version is downloaded, and the install makes a backup first.
    'updates:listVersions': wrapHandler(listVersionsSchema, (i) => updates.listVersions(i.refresh === true)),
    'updates:chooseVersion': wrapHandler(chooseVersionSchema, (i) => updates.chooseVersion(i.version)),
    'updates:installRollback': wrapHandler(checkSchema, async () => { await updates.installRollback(); return {} }),
    'updates:backToLatest': wrapHandler(checkSchema, () => updates.backToLatest())
  }
}
