import { z } from 'zod'
import type { CustomerService } from '../services/customerService'
import { HISTORY_PAGE_MAX } from '../../shared/history/historyList'
import { PARTY_FIELD_MAX } from '../../shared/partyFields'
import { wrapHandler } from './envelope'

const empty = z.object({}).strict()
const id = z.string().min(1).max(64)
const customer = z
  .object({
    name: z.string().min(1).max(PARTY_FIELD_MAX.name),
    phone: z.string().max(PARTY_FIELD_MAX.phone).optional(),
    address: z.string().max(PARTY_FIELD_MAX.address).optional(),
    transport: z.string().max(PARTY_FIELD_MAX.transport).optional()
  })
  .strict()
const createInput = z.object({ customer }).strict()
const updateInput = z.object({ id, customer }).strict()
const deleteInput = z.object({ id }).strict()
const mergeInput = z.object({ survivorId: id, mergedId: id }).strict()
const notSameInput = z.object({ aId: id, bId: id }).strict()
const billsInput = z
  .object({ partyId: id, cursor: z.string().min(1).max(512).optional(), limit: z.number().int().min(1).max(HISTORY_PAGE_MAX).optional() })
  .strict()

/** `customers:*` handlers (Phase 45). IPC calls the service only. */
export function customerHandlers(svc: CustomerService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'customers:list': wrapHandler(empty, () => svc.list()),
    'customers:create': wrapHandler(createInput, (i) => svc.create(i.customer)),
    'customers:update': wrapHandler(updateInput, (i) => svc.update(i.id, i.customer)),
    'customers:delete': wrapHandler(deleteInput, (i) => svc.remove(i.id)),
    'customers:bills': wrapHandler(billsInput, (i) => svc.bills(i)),
    'customers:duplicates': wrapHandler(empty, () => svc.duplicates()),
    'customers:merge': wrapHandler(mergeInput, (i) => svc.merge(i)),
    'customers:notSame': wrapHandler(notSameInput, (i) => svc.notSame(i)),
    'customers:undoLastMerge': wrapHandler(empty, () => svc.undoLastMerge()),
    'customers:unify': wrapHandler(empty, () => svc.unify())
  }
}
