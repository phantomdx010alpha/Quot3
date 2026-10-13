import { z } from 'zod'
import type { Bill } from '../../shared/types'
import type { PrintService } from '../services/printService'
import { billPayloadSchema } from './bills'
import { wrapHandler } from './envelope'

/** The bill as the renderer holds it (the save payload) plus the PO number to print (Professional header). */
export const printBill = billPayloadSchema.extend({ poNumber: z.string().max(64).optional(), roundOff: z.union([z.literal(0), z.literal(1)]).optional() })
const base = {
  bill: printBill,
  mode: z.enum(['rough', 'professional']),
  forced: z.enum(['A4', 'A5', 'auto']).optional()
}
const decideInput = z.object(base).strict()
const printInput = z.object({ ...base, ack: z.boolean().optional() }).strict()
/** An absolute Windows (drive or UNC) or POSIX path - never a relative one, so a renderer cannot steer the write into the app folder. */
const absolutePath = z.string().min(5).max(1024).refine((s) => /^([a-zA-Z]:[\\/]|\/|\\\\)/.test(s), 'Path must be absolute').refine((s) => /\.pdf$/i.test(s), 'File name must end in .pdf')
const pdfInput = z.object({ ...base, ack: z.boolean().optional(), savePath: absolutePath.optional() }).strict()
const openInput = z.object({ filePath: absolutePath }).strict()

/** Fills the fields printing never reads, so the print model gets a complete `Bill`. */
export function billForPrint(p: z.infer<typeof printBill>, now: () => string = () => new Date().toISOString()): Bill {
  const t = now()
  return {
    id: p.id, branchId: 'local', poSeq: 0, poNumber: p.poNumber ?? '', partyId: null, party: p.party, formatId: p.formatId,
    extraCols: p.extraCols, paperOverride: p.paperOverride, billDate: p.billDate, rows: p.rows,
    revision: 1, createdAt: t, updatedAt: t, deletedAt: null, syncState: 'local_only',
    ...(p.roundOff === 1 ? { roundOff: 1 as const } : {}),
    ...(p.footerExtras ? { footerExtras: p.footerExtras } : {}),
    ...(p.tailRows ? { tailRows: p.tailRows } : {})
  }
}

/** `print:*` handlers (Phase 37). IPC calls the service only. */
export function printHandlers(svc: PrintService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'print:decide': wrapHandler(decideInput, (i) => svc.decide({ bill: billForPrint(i.bill), mode: i.mode, forced: i.forced })),
    'print:decideQuick': wrapHandler(decideInput, (i) => svc.decideQuick({ bill: billForPrint(i.bill), mode: i.mode, forced: i.forced })),
    'print:print': wrapHandler(printInput, (i) => svc.print({ bill: billForPrint(i.bill), mode: i.mode, forced: i.forced, ack: i.ack })),
    'print:pdf': wrapHandler(pdfInput, (i) => svc.pdf({ bill: billForPrint(i.bill), mode: i.mode, forced: i.forced, ack: i.ack, savePath: i.savePath })),
    'print:openPdf': wrapHandler(openInput, async (i) => { await svc.openPdf(i.filePath); return {} })
  }
}
