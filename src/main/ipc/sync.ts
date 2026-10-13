import { z } from 'zod'
import type { Outbox } from '../sync/outbox'
import type { RemoteApplier } from '../sync/remoteApplier'
import type { SyncManager } from '../sync/syncManager'
import { retrySchema, setEnabledSchema } from '../../shared/sync/manager'
import { dismissConflictSchema } from '../../shared/sync/conflict'
import { editorPayloadSchema, resolveHeldSchema } from '../../shared/sync/pull'
import { wrapHandler } from './envelope'

const none = z.object({}).strict()

/**
 * `sync:*` handlers. Phase 54: the read-only outbox view. Phase 56: the editor tells main which bill is open, and the owner
 * resolves a change that arrived for it. Phase 59: the manager adds the status page's channels (status, on / off switch, retry, Sync now).
 */
export function syncHandlers(outbox: Outbox, remote?: RemoteApplier, manager?: SyncManager): Record<string, (raw: unknown) => Promise<unknown>> {
  const h: Record<string, (raw: unknown) => Promise<unknown>> = {
    'sync:outbox': wrapHandler(none, () => outbox.status())
  }
  if (remote) {
    h['sync:editor'] = wrapHandler(editorPayloadSchema, (i) => { remote.setOpenBill(i.billId); return { ok: true as const } })
    h['sync:held'] = wrapHandler(none, () => remote.held())
    h['sync:conflicts'] = wrapHandler(none, () => remote.conflicts())
    h['sync:dismissConflict'] = wrapHandler(dismissConflictSchema, (i) => remote.dismissConflict(i.billId))
    h['sync:resolveHeld'] = wrapHandler(resolveHeldSchema, (i) => remote.resolve(i.billId, i.choice))
  }
  if (manager) {
    h['sync:status'] = wrapHandler(none, () => manager.overview())
    h['sync:setEnabled'] = wrapHandler(setEnabledSchema, (i) => manager.setEnabled(i.enabled))
    h['sync:retry'] = wrapHandler(retrySchema, (i) => manager.retry(i.ids))
    h['sync:now'] = wrapHandler(none, () => manager.syncNow())
  }
  return h
}
