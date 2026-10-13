import { z } from 'zod'
import { wrapHandler } from './envelope'
import type { TrashService } from '../services/trashService'

const empty = z.object({}).strict()
const ids = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(500) }).strict()
const emptyTrash = z.object({ confirm: z.literal('EMPTY') }).strict()

/** `trash:*` handlers (Phase 43). IPC calls the service only; inputs are strict. */
export function trashHandlers(svc: TrashService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'trash:list': wrapHandler(empty, () => svc.list()),
    'trash:restore': wrapHandler(ids, ({ ids: i }) => svc.restore(i)),
    'trash:purge': wrapHandler(ids, ({ ids: i }) => svc.purge(i)),
    'trash:emptyTrash': wrapHandler(emptyTrash, () => svc.emptyTrash())
  }
}
