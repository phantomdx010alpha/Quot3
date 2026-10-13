import { z } from 'zod'
import type { BackupService } from '../services/backupService'
import { wrapHandler } from './envelope'

const empty = z.object({}).strict()
const create = z.object({ kind: z.enum(['manual']).optional() }).strict()
const restore = z.object({ file: z.string().min(1).max(200), confirm: z.string().max(40) }).strict()
const file = z.object({ file: z.string().min(1).max(200) }).strict()
const reset = z.object({ confirm: z.string().max(40) }).strict()

/** `backup:*` handlers (Phase 50). IPC calls the service only. */
export function backupHandlers(svc: BackupService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'backup:create': wrapHandler(create, () => svc.create('manual')),
    'backup:list': wrapHandler(empty, () => svc.list()),
    'backup:status': wrapHandler(empty, () => svc.status()),
    'backup:restore': wrapHandler(restore, (i) => svc.restore(i)),
    'backup:delete': wrapHandler(file, (i) => svc.delete(i.file)),
    'backup:importFile': wrapHandler(empty, () => svc.importFile()),
    'backup:resetLocalData': wrapHandler(reset, (i) => svc.resetLocalData(i))
  }
}
