import { z } from 'zod'
import type { SettingsService } from '../services/settingsService'
import { SETTING_KEY_RE } from '../../shared/settings'
import { wrapHandler } from './envelope'

const key = z.string().min(1).max(100).regex(SETTING_KEY_RE)
const getInput = z.object({ key }).strict()
const setInput = z.object({ key, value: z.unknown() }).strict()
const empty = z.object({}).strict()

/** `settings:*` handlers. IPC calls the service only. */
export function settingsHandlers(svc: SettingsService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'settings:get': wrapHandler(getInput, ({ key: k }) => ({ value: svc.get(k) ?? null })),
    'settings:set': wrapHandler(setInput, ({ key: k, value }) => {
      svc.set(k, value)
      return {}
    }),
    'settings:getAll': wrapHandler(empty, () => svc.getAll())
  }
}
