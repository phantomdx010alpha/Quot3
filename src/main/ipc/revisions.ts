import { z } from 'zod'
import { wrapHandler } from './envelope'
import type { RevisionService } from '../services/revisionService'

const billOnly = z.object({ billId: z.string().min(1).max(64) }).strict()
const one = z.object({ billId: z.string().min(1).max(64), revision: z.number().int().min(1).max(1_000_000_000) }).strict()

/** `revisions:*` handlers (Phase 44). IPC calls the service only; inputs are strict. */
export function revisionHandlers(svc: RevisionService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'revisions:list': wrapHandler(billOnly, ({ billId }) => svc.list(billId)),
    'revisions:get': wrapHandler(one, ({ billId, revision }) => svc.get(billId, revision)),
    'revisions:restoreToDraft': wrapHandler(one, ({ billId, revision }) => svc.restoreToDraft(billId, revision))
  }
}
