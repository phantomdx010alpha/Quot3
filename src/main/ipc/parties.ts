import { z } from 'zod'
import type { PartyService } from '../services/partyService'
import { PARTY_FIELD_MAX } from '../../shared/partyFields'
import { wrapHandler } from './envelope'

const empty = z.object({}).strict()
const upsertInput = z
  .object({
    party: z
      .object({
        id: z.string().min(1).max(64).optional(),
        name: z.string().min(1).max(PARTY_FIELD_MAX.name),
        phone: z.string().max(PARTY_FIELD_MAX.phone).optional(),
        address: z.string().max(PARTY_FIELD_MAX.address).optional(),
        transport: z.string().max(PARTY_FIELD_MAX.transport).optional()
      })
      .strict()
  })
  .strict()

/** `parties:*` handlers. IPC calls the service only (`parties:delete` arrives with Phase 45). */
export function partyHandlers(svc: PartyService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'parties:list': wrapHandler(empty, () => svc.list()),
    'parties:upsert': wrapHandler(upsertInput, ({ party }) => svc.upsert(party))
  }
}
