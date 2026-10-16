import { z } from 'zod'
import type { ThemeService } from '../services/themeService'
import type { ThemeShareService } from '../sync/themeShare'
import { AppError, wrapHandler } from './envelope'

const empty = z.object({}).strict()
const exportInput = z
  .object({ id: z.string().min(1).max(40), computed: z.record(z.string().max(60), z.string().max(400)).refine((r) => Object.keys(r).length <= 300, 'too many tokens') })
  .strict()
const titleBarInput = z.object({ bg: z.string().min(1).max(60), symbol: z.string().min(1).max(60), height: z.string().min(1).max(20) }).strict()
const idInput = z.object({ id: z.string().min(1).max(40) }).strict()

/** `themes:*` handlers. IPC calls the service only (layering rule). */
const enabledInput = z.object({ enabled: z.boolean() }).strict()

export function themeHandlers(svc: ThemeService, share?: ThemeShareService): Record<string, (raw: unknown) => Promise<unknown>> {
  const needShare = (): ThemeShareService => { if (!share) throw new AppError('VALIDATION', 'Theme sharing is not available.'); return share }
  return {
    // Phase 171: theme sharing (the rules and the server are in shared/theme/themeShare.ts and supabase/sql/17_themes.sql)
    'themes:shareStatus': wrapHandler(empty, () => needShare().status()),
    'themes:shareSetEnabled': wrapHandler(enabledInput, ({ enabled }) => needShare().setEnabled(enabled)),
    'themes:shareSyncNow': wrapHandler(empty, async () => { const s = needShare(); const run = await s.runNow(); return { run, status: s.status() } }),
    'themes:removeShared': wrapHandler(idInput, ({ id }) => needShare().removeShared(id)),
    'themes:list': wrapHandler(empty, () => svc.list()),
    'themes:reload': wrapHandler(empty, () => svc.reload()),
    'themes:load': wrapHandler(idInput, ({ id }) => svc.load(id)),
    'themes:getActive': wrapHandler(empty, () => ({ id: svc.getActive() })),
    'themes:setActive': wrapHandler(idInput, ({ id }) => ({ id: svc.setActive(id) })),
    'themes:openFolder': wrapHandler(empty, async () => { await svc.openFolder(); return {} }),
    'themes:setTitleBar': wrapHandler(titleBarInput, (i) => { svc.setTitleBar(i); return {} }),
    'themes:exportStarter': wrapHandler(exportInput, (i) => svc.exportStarter(i))
  }
}
