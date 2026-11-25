import { z } from 'zod'
import { SEAT_RIGHT_FLAGS } from '../../shared/seatRights'
import type { SeatRightsService } from '../services/seatRightsService'
import { wrapHandler } from './envelope'

const empty = z.object({}).strict()
/** `set` input: a seat 1..50 and exactly the eleven booleans; extra keys are refused (M25-7). */
const flagsShape = Object.fromEntries(SEAT_RIGHT_FLAGS.map((f) => [f, z.boolean()])) as Record<(typeof SEAT_RIGHT_FLAGS)[number], z.ZodBoolean>
const setInput = z.object({ seatNo: z.number().int().min(1).max(50), flags: z.object(flagsShape).strict() }).strict()

/** `seatRights:*` handlers (Phase 286, channel names frozen in API_CONTRACTS.md M25-7). IPC calls the service only. */
export function seatRightsHandlers(svc: SeatRightsService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'seatRights:list': wrapHandler(empty, () => svc.list()),
    'seatRights:set': wrapHandler(setInput, (i) => svc.set(i.seatNo, i.flags))
  }
}
