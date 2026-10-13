import { z } from 'zod'
import type { CutoverService } from '../sync/cutoverService'
import { wrapHandler } from './envelope'

const none = z.object({}).strict()
const unifyIn = z.object({ skip: z.boolean() }).strict()

/** `cutover:*` handlers (Phase 140). Answers carry counts and a file name only: never a key, password, token or customer name. */
export function cutoverHandlers(svc: CutoverService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'cutover:status': wrapHandler(none, () => svc.status()),
    'cutover:begin': wrapHandler(none, () => svc.begin()),
    'cutover:compare': wrapHandler(none, () => svc.compare()),
    'cutover:unify': wrapHandler(unifyIn, (i) => svc.unify(i))
  }
}
