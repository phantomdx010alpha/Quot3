import { z } from 'zod'
import type { ThemeService } from '../services/themeService'
import { wrapHandler } from './envelope'

const empty = z.object({}).strict()
const exportInput = z
  .object({ id: z.string().min(1).max(40), computed: z.record(z.string().max(60), z.string().max(400)).refine((r) => Object.keys(r).length <= 300, 'too many tokens') })
  .strict()
const titleBarInput = z.object({ bg: z.string().min(1).max(60), symbol: z.string().min(1).max(60), height: z.string().min(1).max(20) }).strict()
const idInput = z.object({ id: z.string().min(1).max(40) }).strict()

/** `themes:*` handlers. IPC calls the service only (layering rule). */
export function themeHandlers(svc: ThemeService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
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
