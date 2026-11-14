import { z } from 'zod'
import { PROFILE_TEXT_MAX, SEAT_LABEL_MAX, SEATS_MAX } from '../../shared/master/schemas'
import type { MasterService } from '../sync/master/masterService'
import { wrapHandler } from './envelope'

const empty = z.object({}).strict()
const seatNo = z.number().int().min(1).max(SEATS_MAX)
const label = z.string().trim().min(1).max(SEAT_LABEL_MAX)
const linkIn = z.object({ enrolToken: z.string().trim().min(8).max(200), label: z.string().trim().min(1).max(80), serviceRoleKey: z.string().trim().min(20).max(4000) }).strict()
const redeemIn = z.object({ code: z.string().max(64) }).strict()
const profileIn = z.object({
  name: z.string().max(PROFILE_TEXT_MAX), phone: z.string().max(PROFILE_TEXT_MAX), address: z.string().max(PROFILE_TEXT_MAX),
  logo: z.string().max(210_000).nullable().optional(), expectVersion: z.number().int().min(0).optional()
}).strict()

/**
 * `master:*` handlers (Phase 263, channel names frozen in API_CONTRACTS.md M24-0 C8). The renderer never receives a password, a device token,
 * an enrol token or the service_role key: `refresh` answers an outcome only, `link` takes the service_role key IN and never returns it.
 * The seat `code` inside a `SeatView` is the one secret that is shown, by design, to seat 1 (the master only sends it to seat 1).
 */
export function masterHandlers(svc: MasterService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'master:status': wrapHandler(empty, () => svc.status()),
    'master:link': wrapHandler(linkIn, (i) => svc.link(i)),
    'master:redeem': wrapHandler(redeemIn, (i) => svc.redeem(i)),
    'master:adopt': wrapHandler(empty, () => svc.adopt()),
    'master:refresh': wrapHandler(empty, () => svc.refreshCredentials()),
    'master:heartbeat': wrapHandler(empty, () => svc.heartbeat()),
    'master:seatList': wrapHandler(empty, () => svc.seatList()),
    'master:seatCreate': wrapHandler(z.object({ label }).strict(), (i) => svc.seatCreate(i)),
    'master:seatReset': wrapHandler(z.object({ seatNo }).strict(), (i) => svc.seatReset(i)),
    'master:seatRevoke': wrapHandler(z.object({ seatNo }).strict(), (i) => svc.seatRevoke(i)),
    'master:seatRename': wrapHandler(z.object({ seatNo, label }).strict(), (i) => svc.seatRename(i)),
    'master:seatRegen': wrapHandler(z.object({ seatNo }).strict(), (i) => svc.seatRegen(i)),
    'master:profileGet': wrapHandler(empty, () => svc.profileGet()),
    'master:profileSet': wrapHandler(profileIn, (i) => svc.profileSet(i))
  }
}
