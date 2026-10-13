import { bootstrapApplySchema, bootstrapPreviewSchema } from '../../shared/sync/bootstrap'
import type { BootstrapService } from '../sync/bootstrapService'
import { wrapHandler } from './envelope'

/** `bootstrap:*` handlers (Phase 58). IPC calls the service only; the backup file comes from `backup:importFile`. */
export function bootstrapHandlers(svc: BootstrapService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'bootstrap:preview': wrapHandler(bootstrapPreviewSchema, (i) => svc.preview(i.file)),
    'bootstrap:apply': wrapHandler(bootstrapApplySchema, (i) => svc.apply(i))
  }
}
