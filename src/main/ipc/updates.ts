import { z } from 'zod'
import { checkSchema, setBusySchema, UPDATE_FEED_MAX } from '../../shared/updater'
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
    'updates:setConfig': wrapHandler(configSchema, (i) => updates.setConfig(i))
  }
}
