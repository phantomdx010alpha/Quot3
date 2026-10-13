import { z } from 'zod'
import type { DraftService } from '../services/draftService'
import { wrapHandler } from './envelope'

const empty = z.object({}).strict()
const id = z.string().min(1).max(64)
/** 8 MB: a 2000-row bill with long names is far below this; it only stops a runaway payload. */
const MAX_PAYLOAD_CHARS = 8_000_000
const saveInput = z
  .object({ draftId: id.optional(), billId: id.optional(), payload: z.string().min(2).max(MAX_PAYLOAD_CHARS) })
  .strict()

/**
 * `drafts:*` handlers (Phase 29). The payload is a JSON STRING that the service re-parses with the shared lenient reader,
 * so the stored bill is always one `normalizeBill` accepts; the IPC layer only bounds sizes and ids.
 */
export function draftHandlers(svc: DraftService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'drafts:save': wrapHandler(saveInput, (input) => svc.save(input)),
    'drafts:list': wrapHandler(empty, () => svc.list()),
    'drafts:get': wrapHandler(z.object({ id }).strict(), ({ id: draftId }) => svc.get(draftId)),
    'drafts:delete': wrapHandler(z.object({ id }).strict(), ({ id: draftId }) => svc.delete(draftId))
  }
}
