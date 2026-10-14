/**
 * Bill data model helpers (Phase 8, pure): empty bill, normalisation, and (de)serialisation between the
 * in-memory `Bill` and the DB row shapes of DATA_MODEL.md. No persistence calls here — Phase 27 owns those.
 * Rows are a SUPERSET: nothing here ever drops or resets row data when `formatId` changes.
 */
import { z } from 'zod'
import { computeBill } from './calc/billTotals'
import { getBillOptions, normalizeRoundOff } from './calc/billOptions'
import { rowName } from './calc/classifyRow'
import { defaultFormatId, hasFormat, resolveFormat } from './format/registry'
import { tryD } from './money'
import { FOOTER_EXTRA_KEYS } from './types'
import type { Bill, BillRow, Dec, ExtraCell, ExtraColDef, FooterExtras, HybridSecond, IsoDate, IsoDateTime, PartySnapshot, Run, SyncState, TailRow } from './types'

// ---------- ids / defaults ----------
export type NewId = () => string
const defaultNewId: NewId = () => globalThis.crypto.randomUUID()

export const EMPTY_PARTY: PartySnapshot = Object.freeze({ name: '', phone: '', address: '', transport: '' })

export function defaultExtraColHeader(n: number): string {
  return `Col ${n}`
}

export function createEmptyRow(idx: number, newId: NewId = defaultNewId): BillRow {
  return { id: newId(), idx, nameRuns: [], qty: null, rate: null, totalOverride: null, gstRate: null, extras: {} }
}

export interface CreateEmptyBillOptions {
  branchId: string
  /** Defaults to the registry's default format. */
  formatId?: string
  /** Number of blank rows to start with (default 1; the grid pads for display). */
  rowCount?: number
  /** Phase 77: a NEW bill follows the `calc.roundOff` setting (the flag is stamped again, authoritatively, on save). */
  roundOff?: boolean
  /** Today, ISO date. Callers pass a local date; default = UTC today. */
  billDate?: IsoDate
  now?: IsoDateTime
  newId?: NewId
}

/**
 * A new, unsaved bill. `poSeq` 0 and `poNumber` '' mean "not allocated yet" — the PO number is allocated
 * inside the save transaction (Phase 27), never here.
 */
export function createEmptyBill(o: CreateEmptyBillOptions): Bill {
  const newId = o.newId ?? defaultNewId
  const now = o.now ?? new Date().toISOString()
  const formatId = o.formatId && hasFormat(o.formatId) ? o.formatId : defaultFormatId()
  const n = Math.max(0, Math.floor(o.rowCount ?? 1))
  return {
    id: newId(), branchId: o.branchId, poSeq: 0, poNumber: '',
    partyId: null, party: { ...EMPTY_PARTY },
    formatId, extraCols: [], paperOverride: null,
    ...(o.roundOff === undefined ? {} : { roundOff: o.roundOff ? (1 as const) : (0 as const) }),
    billDate: o.billDate ?? now.slice(0, 10),
    rows: Array.from({ length: n }, (_, i) => createEmptyRow(i, newId)),
    revision: 1, createdAt: now, updatedAt: now, deletedAt: null, syncState: 'local_only'
  }
}

// ---------- normalisation ----------
const DEC_RE = /^-?\d+(\.\d+)?$/
const isDec = (s: string): boolean => DEC_RE.test(s)

/**
 * Phase 149: qty may be FREE TEXT ("two dozen") because the Stock transfer format keeps it as typed. A number is cleaned exactly as
 * `cleanDec` does; anything else is kept (trimmed, capped), never dropped, so switching formats loses nothing. Other formats show a
 * non-number qty with an INVALID_NUMBER warning and do no maths with it.
 */
export const QTY_TEXT_LIMIT = 200
function cleanQty(v: unknown): Dec | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (t === '') return null
  const d = cleanDec(t)
  return d !== null ? d : t.slice(0, QTY_TEXT_LIMIT)
}

/** blank → null; a complete decimal → trimmed as typed; anything else → null (the model holds only valid Dec). */
function cleanDec(v: unknown): Dec | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (t === '') return null
  const d = tryD(t)
  if (d === null) return null
  if (isDec(t)) return t
  return d.toFixed() // "12." / ".5" / "+3" → plain notation
}

function cleanRuns(v: unknown): Run[] {
  if (!Array.isArray(v)) return []
  const out: Run[] = []
  for (const r of v) {
    if (!r || typeof r !== 'object' || typeof (r as Run).t !== 'string' || (r as Run).t === '') continue
    const { t, b, r: red, hl } = r as Run
    const run: Run = { t }
    if (b) run.b = 1
    if (red) run.r = 1
    if (hl) run.hl = 1
    out.push(run)
  }
  return out
}

function cleanExtras(v: unknown): Record<string, ExtraCell> {
  const out: Record<string, ExtraCell> = {}
  if (!v || typeof v !== 'object') return out
  for (const [k, c] of Object.entries(v as Record<string, unknown>)) {
    if (!c || typeof c !== 'object') continue
    const text = typeof (c as ExtraCell).text === 'string' ? (c as ExtraCell).text : ''
    out[k] = (c as ExtraCell).marked ? { text, marked: true } : { text }
  }
  return out
}

/** Free-cell maps (footer / tail): same cell shape as a row's extras, but a cell with no text and no mark carries nothing and is dropped. */
function cleanFreeCells(v: unknown): Record<string, ExtraCell> {
  const out: Record<string, ExtraCell> = {}
  for (const [k, c] of Object.entries(cleanExtras(v))) if (c.text !== '' || c.marked) out[k] = c
  return out
}

/** Phase 79: only the three known footer keys survive; empty rows / cells vanish. Returns undefined when nothing is left (field absent = none). */
export function cleanFooterExtras(v: unknown): FooterExtras | undefined {
  if (!v || typeof v !== 'object') return undefined
  const out: FooterExtras = {}
  for (const key of FOOTER_EXTRA_KEYS) {
    const cells = cleanFreeCells((v as Record<string, unknown>)[key])
    if (Object.keys(cells).length > 0) out[key] = cells
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Phase 79: tail rows keep their order; trailing empty rows are trimmed (trim-on-save), blank rows in between stay. Undefined when none remain. */
export function cleanTailRows(v: unknown): TailRow[] | undefined {
  if (!Array.isArray(v)) return undefined
  const rows: TailRow[] = v.map((r) => ({ extras: cleanFreeCells((r as { extras?: unknown } | null)?.extras) }))
  let n = rows.length
  while (n > 0 && Object.keys((rows[n - 1] as TailRow).extras).length === 0) n--
  return n > 0 ? rows.slice(0, n) : undefined
}

function cleanCellStyle(v: unknown): BillRow['cellStyle'] {
  if (!v || typeof v !== 'object') return undefined
  const out: Record<string, { hl?: 1 }> = {}
  for (const [k, s] of Object.entries(v as Record<string, { hl?: unknown }>)) if (s && s.hl) out[k] = { hl: 1 }
  return Object.keys(out).length ? out : undefined
}

/** One row in canonical shape (shared by the primary rows and the Hybrid second table). */
function cleanRow(r: BillRow, id: string, idx: number): BillRow {
  const row: BillRow = {
    id, idx, nameRuns: cleanRuns(r.nameRuns),
    qty: cleanQty(r.qty), rate: cleanDec(r.rate), totalOverride: cleanDec(r.totalOverride), gstRate: cleanDec(r.gstRate),
    extras: cleanExtras(r.extras)
  }
  const cs = cleanCellStyle(r.cellStyle)
  if (cs) row.cellStyle = cs
  return row
}

/**
 * Phase 150: the Hybrid second table in canonical shape. Junk / unknown `primary` -> undefined (no second table). Second-table row
 * ids are made unique AND different from every id in `takenIds` (the primary rows), `idx` is contiguous, and `twins` keeps only
 * pairs whose second row is here and whose primary row is in `takenIds`. Idempotent. Never touches the primary rows.
 */
export function cleanHybrid(v: unknown, takenIds: ReadonlySet<string>, newId: NewId = defaultNewId): HybridSecond | undefined {
  if (!v || typeof v !== 'object') return undefined
  const h = v as Partial<HybridSecond>
  if (h.primary !== 'gst' && h.primary !== 'non_gst') return undefined
  const ids = new Set<string>(takenIds)
  const rows = (Array.isArray(h.rows) ? h.rows : []).filter((r) => r && typeof r === 'object').map((r, i): BillRow => {
    let id = typeof r.id === 'string' && r.id !== '' && !ids.has(r.id) ? r.id : newId()
    while (ids.has(id)) id = newId()
    ids.add(id)
    return cleanRow(r, id, i)
  })
  const twins: Record<string, string> = {}
  const keep = new Set(rows.map((r) => r.id))
  const used = new Set<string>()
  for (const [second, primary] of Object.entries(h.twins && typeof h.twins === 'object' ? h.twins : {})) {
    if (typeof primary === 'string' && keep.has(second) && takenIds.has(primary) && !used.has(primary)) { twins[second] = primary; used.add(primary) }
  }
  return { primary: h.primary, active: h.active === true, rows, twins }
}

export function normalizeExtraCols(cols: readonly ExtraColDef[] | null | undefined): ExtraColDef[] {
  const seen = new Set<string>()
  const out: ExtraColDef[] = []
  for (const c of cols ?? []) {
    if (!c || typeof c.key !== 'string' || c.key === '' || seen.has(c.key)) continue
    seen.add(c.key)
    out.push({ key: c.key, header: (c.header ?? '').trim() || defaultExtraColHeader(out.length + 1), kind: 'units' })
  }
  return out
}

/**
 * Repairs a bill into canonical shape WITHOUT losing entered data: unknown `formatId` → default; extra columns
 * de-duplicated (blank headers get "Col N"); rows get unique ids and contiguous `idx` in array order; blank decimals
 * → null and invalid decimals → null; empty/garbage runs dropped; extras for keys not in `extraCols` are KEPT
 * (a column may be re-added). Idempotent. Never touches `formatId`-dependent data.
 */
export function normalizeBill(bill: Bill, newId: NewId = defaultNewId): Bill {
  const ids = new Set<string>()
  const rows = bill.rows.map((r, i): BillRow => {
    let id = typeof r.id === 'string' && r.id !== '' && !ids.has(r.id) ? r.id : newId()
    while (ids.has(id)) id = newId()
    ids.add(id)
    return cleanRow(r, id, i)
  })
  const party: PartySnapshot = {
    name: bill.party?.name ?? '', phone: bill.party?.phone ?? '', address: bill.party?.address ?? '', transport: bill.party?.transport ?? ''
  }
  const { footerExtras: _fe, tailRows: _tr, hybrid: _hy, ...rest } = bill
  const hybrid = cleanHybrid(_hy, ids, newId)
  const footerExtras = cleanFooterExtras(_fe)
  const tailRows = cleanTailRows(_tr)
  return {
    ...rest,
    party,
    // Phase 150: while the Hybrid view is on, the primary rows are laid out in the primary side's format.
    formatId: hybrid?.active ? hybrid.primary : hasFormat(bill.formatId) ? bill.formatId : defaultFormatId(),
    extraCols: normalizeExtraCols(bill.extraCols),
    paperOverride: bill.paperOverride === 'A4' || bill.paperOverride === 'A5' ? bill.paperOverride : null,
    ...(bill.roundOff === undefined ? {} : { roundOff: normalizeRoundOff(bill.roundOff) }),
    ...(footerExtras ? { footerExtras } : {}),
    ...(tailRows ? { tailRows } : {}),
    ...(hybrid ? { hybrid } : {}),
    rows
  }
}

// ---------- Zod schemas (storage boundary) ----------
const decS = z.string().regex(DEC_RE)
const runS = z.object({ t: z.string(), b: z.literal(1).optional(), r: z.literal(1).optional(), hl: z.literal(1).optional() }).strict()
const extraCellS = z.object({ text: z.string(), marked: z.boolean().optional() }).strict()
export const extraColDefSchema = z.object({ key: z.string().min(1), header: z.string(), kind: z.literal('units') }).strict()
export const partySnapshotSchema = z.object({ name: z.string(), phone: z.string(), address: z.string(), transport: z.string() }).strict()
const freeCellsS = z.record(z.string(), extraCellS)
const footerExtrasS = z.object({ itemsTotal: freeCellsS.optional(), adjustmentsTotal: freeCellsS.optional(), grandTotal: freeCellsS.optional() })
const tailRowsS = z.array(z.object({ extras: freeCellsS }))
const cellStyleS = z.record(z.string(), z.object({ hl: z.literal(1).optional() }).strict())
const hybridRowS = z.object({
  id: z.string().min(1), nameRuns: z.array(runS), qty: z.string().max(QTY_TEXT_LIMIT).nullable(), rate: decS.nullable(), totalOverride: decS.nullable(), gstRate: decS.nullable(),
  extras: z.record(z.string(), extraCellS), cellStyle: cellStyleS.optional()
})
/** Phase 150: `bills.second_table_json`. */
const hybridS = z.object({
  v: z.literal(1), primary: z.enum(['gst', 'non_gst']), active: z.boolean(), rows: z.array(hybridRowS), twins: z.record(z.string(), z.string())
})
export function hybridToJson(h: HybridSecond | undefined): string {
  if (!h) return ''
  return JSON.stringify({
    v: 1, primary: h.primary, active: h.active, twins: h.twins,
    rows: h.rows.map((r) => ({ id: r.id, nameRuns: r.nameRuns, qty: r.qty, rate: r.rate, totalOverride: r.totalOverride, gstRate: r.gstRate, extras: r.extras, ...(r.cellStyle ? { cellStyle: r.cellStyle } : {}) }))
  })
}

export const syncStateSchema = z.enum(['local_only', 'pending', 'synced', 'conflict'])

/** Shape of a `bill_rows` row (Drizzle property names). */
export const billRowRecordSchema = z.object({
  id: z.string().min(1), billId: z.string().min(1), idx: z.number().int().min(0),
  nameRunsJson: z.string(), namePlain: z.string(),
  qty: z.string().max(QTY_TEXT_LIMIT).nullable(), rate: decS.nullable(), totalOverride: decS.nullable(), gstRate: decS.nullable(),
  extrasJson: z.string(), cellStyleJson: z.string().nullable()
})
export type BillRowRecord = z.infer<typeof billRowRecordSchema>

/** Shape of a `bills` row (Drizzle property names). */
export const billRecordSchema = z.object({
  id: z.string().min(1), branchId: z.string().min(1), poSeq: z.number().int().min(0), poNumber: z.string(),
  partyId: z.string().nullable(), partySnapshotJson: z.string(),
  formatId: z.string().min(1), extraColsJson: z.string(), paperOverride: z.enum(['A4', 'A5']).nullable(),
  /** Phase 77: `bills.round_off` (absent in an older snapshot = 0). */
  roundOff: z.union([z.literal(0), z.literal(1)]).optional(),
  /** Phase 79: `bills.footer_extras_json` / `bills.tail_rows_json` (absent in an older snapshot = none; an old branch ignores them: zod strips unknown keys). */
  footerExtrasJson: z.string().optional(),
  tailRowsJson: z.string().optional(),
  /** Phase 150: the Hybrid second table (`bills.second_table_json`; absent / '' = none; an older branch strips it: zod strips unknown keys). */
  secondTableJson: z.string().optional(),
  /** Phase 88: legacy-import tags travel with the bill (absent = a bill made here / an older branch; an old branch strips them). */
  legacyRef: z.string().nullable().optional(),
  importBatchId: z.string().nullable().optional(),
  importFingerprint: z.string().nullable().optional(),
  billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalsJson: z.string(), itemRowCount: z.number().int().min(0),
  revision: z.number().int().min(1),
  createdAt: z.string(), updatedAt: z.string(), deletedAt: z.string().nullable(), syncState: syncStateSchema
})
export type BillRecord = z.infer<typeof billRecordSchema>

/** Cached list-view totals (`bills.totals_json`) — derived, recomputable (DATA_MODEL). */
export interface BillTotalsCache { itemsSubtotal: Dec; adjustmentsTotal: Dec; grandTotal: Dec; gstTotal: Dec }

export interface SerializedBill { bill: BillRecord; rows: BillRowRecord[] }

export function plainName(row: Pick<BillRow, 'nameRuns'>): string {
  return rowName(row)
}

/** Bill → DB shapes. Normalises first; recomputes the totals cache with the bill's own format. */
export function serializeBill(input: Bill): SerializedBill {
  const bill = normalizeBill(input)
  const totals = computeBill(resolveFormat(bill.formatId), bill.rows, getBillOptions(bill))
  const cache: BillTotalsCache = {
    itemsSubtotal: totals.itemsTotal, adjustmentsTotal: totals.adjustmentsTotal, grandTotal: totals.grandTotal, gstTotal: totals.itemsGst
  }
  const record: BillRecord = {
    id: bill.id, branchId: bill.branchId, poSeq: bill.poSeq, poNumber: bill.poNumber,
    partyId: bill.partyId, partySnapshotJson: JSON.stringify(bill.party),
    formatId: bill.formatId, extraColsJson: JSON.stringify(bill.extraCols), paperOverride: bill.paperOverride, roundOff: normalizeRoundOff(bill.roundOff),
    footerExtrasJson: JSON.stringify(bill.footerExtras ?? {}), tailRowsJson: JSON.stringify(bill.tailRows ?? []), secondTableJson: hybridToJson(bill.hybrid),
    billDate: bill.billDate, totalsJson: JSON.stringify(cache), itemRowCount: totals.counts.itemRows,
    revision: bill.revision, createdAt: bill.createdAt, updatedAt: bill.updatedAt, deletedAt: bill.deletedAt, syncState: bill.syncState
  }
  const rows: BillRowRecord[] = bill.rows.map((r) => ({
    id: r.id, billId: bill.id, idx: r.idx,
    nameRunsJson: JSON.stringify(r.nameRuns), namePlain: plainName(r),
    qty: r.qty, rate: r.rate, totalOverride: r.totalOverride, gstRate: r.gstRate,
    extrasJson: JSON.stringify(r.extras), cellStyleJson: r.cellStyle ? JSON.stringify(r.cellStyle) : null
  }))
  return { bill: billRecordSchema.parse(record), rows: rows.map((r) => billRowRecordSchema.parse(r)) }
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string }

function parseJson<T>(raw: string, schema: z.ZodType<T>, what: string): ParseResult<T> {
  let v: unknown
  try { v = JSON.parse(raw) } catch { return { ok: false, error: `${what}: invalid JSON` } }
  const r = schema.safeParse(v)
  return r.success ? { ok: true, data: r.data } : { ok: false, error: `${what}: ${r.error.issues[0]?.message ?? 'invalid'}` }
}

/**
 * DB shapes → Bill. Non-throwing: any malformed record/JSON returns `{ ok:false }`. Rows are ordered by `idx`.
 * An unknown `format_id` is kept as stored (the registry may be older than the data); callers use `resolveFormat`.
 */
export function deserializeBill(recordIn: unknown, rowsIn: unknown[]): ParseResult<Bill> {
  const rec = billRecordSchema.safeParse(recordIn)
  if (!rec.success) return { ok: false, error: `bill: ${rec.error.issues[0]?.path.join('.')} ${rec.error.issues[0]?.message}` }
  const b = rec.data
  const party = parseJson(b.partySnapshotJson, partySnapshotSchema, 'party_snapshot_json')
  if (!party.ok) return party
  const extraCols = parseJson(b.extraColsJson, z.array(extraColDefSchema), 'extra_cols_json')
  if (!extraCols.ok) return extraCols
  const footer = b.footerExtrasJson === undefined || b.footerExtrasJson === '' ? null : parseJson(b.footerExtrasJson, footerExtrasS, 'footer_extras_json')
  if (footer && !footer.ok) return footer
  const tail = b.tailRowsJson === undefined || b.tailRowsJson === '' ? null : parseJson(b.tailRowsJson, tailRowsS, 'tail_rows_json')
  if (tail && !tail.ok) return tail
  const second = b.secondTableJson === undefined || b.secondTableJson === '' ? null : parseJson(b.secondTableJson, hybridS, 'second_table_json')
  if (second && !second.ok) return second
  const footerExtras = footer ? cleanFooterExtras(footer.data) : undefined
  const tailRows = tail ? cleanTailRows(tail.data) : undefined

  const rows: BillRow[] = []
  for (const raw of rowsIn) {
    const rr = billRowRecordSchema.safeParse(raw)
    if (!rr.success) return { ok: false, error: `bill_rows: ${rr.error.issues[0]?.path.join('.')} ${rr.error.issues[0]?.message}` }
    const r = rr.data
    if (r.billId !== b.id) return { ok: false, error: `bill_rows: row ${r.id} belongs to another bill` }
    const runs = parseJson(r.nameRunsJson, z.array(runS), 'name_runs_json')
    if (!runs.ok) return runs
    const extras = parseJson(r.extrasJson, z.record(z.string(), extraCellS), 'extras_json')
    if (!extras.ok) return extras
    const row: BillRow = {
      id: r.id, idx: r.idx, nameRuns: runs.data, qty: r.qty, rate: r.rate, totalOverride: r.totalOverride, gstRate: r.gstRate,
      extras: extras.data
    }
    if (r.cellStyleJson !== null) {
      const cs = parseJson(r.cellStyleJson, cellStyleS, 'cell_style_json')
      if (!cs.ok) return cs
      row.cellStyle = cs.data
    }
    rows.push(row)
  }
  rows.sort((a, c) => a.idx - c.idx)

  const bill: Bill = {
    id: b.id, branchId: b.branchId, poSeq: b.poSeq, poNumber: b.poNumber,
    partyId: b.partyId, party: party.data, formatId: b.formatId, extraCols: extraCols.data,
    paperOverride: b.paperOverride, billDate: b.billDate, rows,
    ...(b.roundOff === 1 ? { roundOff: 1 as const } : {}),
    ...(footerExtras ? { footerExtras } : {}),
    ...(tailRows ? { tailRows } : {}),
    ...(second ? { hybrid: { primary: second.data.primary, active: second.data.active, twins: second.data.twins, rows: second.data.rows.map((r, i): BillRow => ({ ...r, idx: i })) } } : {}),
    revision: b.revision, createdAt: b.createdAt, updatedAt: b.updatedAt, deletedAt: b.deletedAt, syncState: b.syncState as SyncState
  }
  return { ok: true, data: bill }
}

/**
 * Switch the active format. Returns a new bill whose `rows` are the SAME array (reference-identical, hence
 * byte-identical); only `formatId` changes. Unknown ids are refused (returns the bill unchanged).
 */
export function withFormat(bill: Bill, formatId: string): Bill {
  if (!hasFormat(formatId) || bill.formatId === formatId) return bill
  return { ...bill, formatId }
}
