import { z } from 'zod'
import type { ItemsService } from '../services/itemsService'
import { AppError, wrapHandler } from './envelope'

const empty = z.object({}).strict()
const groupInput = z.object({ groupId: z.string().min(1).max(500) }).strict()
const salesInput = z.object({ groupId: z.string().min(1).max(500), partyKey: z.string().min(1).max(600).optional() }).strict()
const key = z.string().min(1).max(600)
const gid = z.string().min(1).max(500)
const decideInput = z.discriminatedUnion('op', [
  z.object({ op: z.literal('merge'), fromGroupId: gid, intoGroupId: gid }).strict(),
  z.object({ op: z.literal('reject'), fromGroupId: gid, intoGroupId: gid }).strict(),
  z.object({ op: z.literal('split'), groupId: gid, spellingKey: key }).strict(),
  z.object({ op: z.literal('move'), groupId: gid, spellingKey: key, intoGroupId: gid }).strict(),
  z.object({ op: z.literal('ignore'), groupId: gid }).strict()
])
const billInput = z.object({ billId: z.string().min(1).max(64) }).strict()

/** `items:*` handlers (Phase 110). The Items page never changes a bill (Phase 113 adds decisions, which only save owner rules). IPC calls the service only. */
export function itemsHandlers(svc: ItemsService, emit: (channel: 'items:progress', payload: { done: number; total: number }) => void): Record<string, (raw: unknown) => Promise<unknown>> {
  let rebuilding = false
  return {
    'items:overview': wrapHandler(empty, () => svc.overview()),
    'items:group': wrapHandler(groupInput, (i) => svc.group(i.groupId)),
    'items:sales': wrapHandler(salesInput, (i) => svc.sales(i)),
    'items:openTarget': wrapHandler(billInput, (i) => svc.openTarget(i.billId)),
    // Phase 113: the only writes of the Items page. They save owner RULES; bills are never changed.
    'items:decide': wrapHandler(decideInput, (i) => svc.decide(i)),
    'items:undo': wrapHandler(empty, () => svc.undoLast()),
    'items:lastDecision': wrapHandler(empty, () => svc.lastDecision()),
    'items:rebuild': wrapHandler(empty, async () => {
      if (rebuilding) throw new AppError('VALIDATION', 'A rebuild is already running')
      rebuilding = true
      try { return await svc.rebuild((p) => emit('items:progress', p)) } finally { rebuilding = false }
    })
  }
}
