import { readFileSync } from 'node:fs'

/** Phase 66 - plain bill payloads for the specs that check OUTPUT (PDF / image) or storage, built straight against the bridge. */

type Row = {
  id: string; idx: number; nameRuns: { t: string; b?: 1; r?: 1 }[]; qty: string | null; rate: string | null
  totalOverride: string | null; gstRate: string | null; extras: Record<string, { text: string; marked?: boolean }>
}

export function itemRow(i: number, name: string, rate: string, qty: string, extras: Row['extras'] = {}): Row {
  return { id: `e2e-r${i}`, idx: i, nameRuns: [{ t: name }], qty, rate, totalOverride: null, gstRate: null, extras }
}
export function adjustmentRow(i: number, name: string, amount: string): Row {
  return { id: `e2e-r${i}`, idx: i, nameRuns: [{ t: name }], qty: null, rate: null, totalOverride: amount, gstRate: null, extras: {} }
}

export function billPayload(opts: { id?: string; party?: string; formatId?: string; rows: Row[]; extraCols?: { key: string; header: string; kind: 'units' }[]; billDate?: string; poNumber?: string }) {
  return {
    id: opts.id ?? 'e2e-bill-1',
    party: { name: opts.party ?? 'E2E Traders', phone: '', address: '', transport: '' },
    formatId: opts.formatId ?? 'non_gst',
    extraCols: opts.extraCols ?? [],
    paperOverride: null,
    billDate: opts.billDate ?? new Date().toISOString().slice(0, 10),
    rows: opts.rows,
    ...(opts.poNumber ? { poNumber: opts.poNumber } : {})
  }
}

/** n numbered items, each Rs 10 x 1. */
export function manyItems(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => itemRow(i, `Item ${i + 1}`, '10', '1'))
}

/** Page size in PDF points (1/72 in) read from the first /MediaBox of the file. Null when none is found. */
export function pdfPageSize(file: string): { w: number; h: number } | null {
  const text = readFileSync(file).toString('latin1')
  const m = /\/MediaBox\s*\[\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s*\]/.exec(text)
  if (!m) return null
  return { w: Math.round(Number(m[3]) - Number(m[1])), h: Math.round(Number(m[4]) - Number(m[2])) }
}
/** ISO paper sizes in points, rounded: A5 = 420 x 595, A4 = 595 x 842. */
export const PAPER_PT = { A5: { w: 420, h: 595 }, A4: { w: 595, h: 842 } } as const

/** Width and height of a PNG from its header. */
export function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24 || buf.toString('latin1', 1, 4) !== 'PNG') throw new Error('not a PNG')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}
