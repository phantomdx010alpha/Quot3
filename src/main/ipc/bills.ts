import { z } from 'zod'
import type { BillService } from '../services/billService'
import { PARTY_FIELD_MAX } from '../../shared/partyFields'
import { MAX_EXTRA_COLS } from '../../shared/extraCols'
import { wrapHandler } from './envelope'

const empty = z.object({}).strict()
const MAX_ROWS = 2000
const dec = z.string().max(40).nullable()
const run = z.object({ t: z.string().max(2000), b: z.literal(1).optional(), r: z.literal(1).optional(), hl: z.literal(1).optional() }).strict()
const extraCell = z.object({ text: z.string().max(2000), marked: z.boolean().optional() }).strict()
const row = z
  .object({
    id: z.string().min(1).max(64),
    idx: z.number().int().min(0).max(100000),
    nameRuns: z.array(run).max(500),
    qty: z.string().max(200).nullable(), rate: dec, totalOverride: dec, gstRate: dec, // Phase 149: qty may be free text (Stock transfer)
    extras: z.record(z.string().max(64), extraCell),
    cellStyle: z.record(z.string().max(64), z.object({ hl: z.literal(1).optional() }).strict()).optional()
  })
  .strict()
const freeCells = z.record(z.string().max(64), extraCell)
const footerExtrasPayload = z.object({ itemsTotal: freeCells.optional(), adjustmentsTotal: freeCells.optional(), grandTotal: freeCells.optional() }).strict()
const tailRowsPayload = z.array(z.object({ extras: freeCells }).strict()).max(MAX_ROWS)
export const billPayloadSchema = z
  .object({
    id: z.string().min(1).max(64),
    party: z
      .object({
        name: z.string().max(PARTY_FIELD_MAX.name * 2),
        phone: z.string().max(PARTY_FIELD_MAX.phone * 2),
        address: z.string().max(PARTY_FIELD_MAX.address * 2),
        transport: z.string().max(PARTY_FIELD_MAX.transport * 2)
      })
      .strict(),
    formatId: z.string().min(1).max(64),
    extraCols: z.array(z.object({ key: z.string().min(1).max(64), header: z.string().max(200), kind: z.literal('units') }).strict()).max(MAX_EXTRA_COLS),
    paperOverride: z.enum(['A4', 'A5']).nullable(),
    billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rows: z.array(row).max(MAX_ROWS),
    /** Phase 79: free extra cells on the footer rows and extra-only tail rows (both optional; absent = none). */
    footerExtras: footerExtrasPayload.optional(),
    tailRows: tailRowsPayload.optional()
  })
  .strict()
const saveInput = z.object({ bill: billPayloadSchema, expectedRevision: z.number().int().min(1).optional() }).strict()

/** `bills:*` handlers (Phase 27). IPC calls the service only; `getForEdit` is Phase 28, `delete` (soft, Phase 42). */
export function billHandlers(svc: BillService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'bills:newDefaults': wrapHandler(empty, () => svc.newDefaults()),
    'bills:getForEdit': wrapHandler(z.object({ id: z.string().min(1).max(64) }).strict(), ({ id }) => svc.getForEdit(id)),
    'bills:delete': wrapHandler(z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(500) }).strict(), ({ ids }) => svc.delete(ids)),
    'bills:save': wrapHandler(saveInput, (input) => svc.save(input))
  }
}
