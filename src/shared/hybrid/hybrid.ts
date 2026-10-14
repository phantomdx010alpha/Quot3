/**
 * Phase 150 - Hybrid format, pure logic (contract: API_CONTRACTS.md "Phase 150 as built"; owner rules: MILESTONE14_DESIGN.md 1.6).
 * A Hybrid bill = the primary table (`bill.rows`, layout `hybrid.primary`) + a second table (`bill.hybrid.rows`, the OTHER layout).
 * Everything here returns NEW objects and never mutates its input. No DOM, no Electron, no Node, no floating-point money.
 */
import { withFormat } from '../billModel'
import { getBillOptions } from '../calc/billOptions'
import { computeBill, type BillTotals } from '../calc/billTotals'
import { classifyRow } from '../calc/classifyRow'
import { getFormat } from '../format/registry'
import type { Bill, BillRow, ExtraCell, HybridSecond, HybridSide, Id } from '../types'

export type NewId = () => string
const defaultNewId: NewId = () => globalThis.crypto.randomUUID()

export const otherSide = (side: HybridSide): HybridSide => (side === 'gst' ? 'non_gst' : 'gst')
export const isHybridSide = (v: unknown): v is HybridSide => v === 'gst' || v === 'non_gst'

/** The bill carries a second table (whether or not the Hybrid view is on). */
export const isHybrid = (bill: Pick<Bill, 'hybrid'>): boolean => !!bill.hybrid
/** The side-by-side Hybrid view is on. */
export const isHybridActive = (bill: Pick<Bill, 'hybrid'>): boolean => bill.hybrid?.active === true

/** The layout of the primary table: `hybrid.primary` when there is a second table, else the bill's own GST / non-GST format, else null. */
export function primarySide(bill: Pick<Bill, 'hybrid' | 'formatId'>): HybridSide | null {
  if (bill.hybrid) return bill.hybrid.primary
  return isHybridSide(bill.formatId) ? bill.formatId : null
}

/** A bill can be made Hybrid when it already is, or is a GST / non-GST bill (Stock transfer and unknown formats cannot). */
export const canHybrid = (bill: Pick<Bill, 'hybrid' | 'formatId'>): boolean => primarySide(bill) !== null

const isAdjustment = (r: BillRow): boolean => classifyRow(r) === 'adjustment'

function cloneExtras(e: Record<string, ExtraCell>): Record<string, ExtraCell> {
  const out: Record<string, ExtraCell> = {}
  for (const [k, c] of Object.entries(e)) out[k] = c.marked ? { text: c.text, marked: true } : { text: c.text }
  return out
}

/**
 * One copied row: a NEW id; name runs, qty, rate and total override copied; GST % is never copied (it means nothing in the
 * non-GST layout and the second table is independent); cell highlights copied. `extras` is what the copy starts with.
 */
function copyRow(r: BillRow, idx: number, extras: Record<string, ExtraCell>, newId: NewId): BillRow {
  const row: BillRow = {
    id: newId(), idx, nameRuns: r.nameRuns.map((x) => ({ ...x })), qty: r.qty, rate: r.rate, totalOverride: r.totalOverride, gstRate: null, extras
  }
  if (r.cellStyle) row.cellStyle = Object.fromEntries(Object.entries(r.cellStyle).map(([k, v]) => [k, { ...v }]))
  return row
}

/** Copy source: every non-adjustment row (adjustment rows and their labels are NOT copied), trailing blank rows trimmed. */
function copyable(rows: readonly BillRow[]): BillRow[] {
  const keep = rows.filter((r) => !isAdjustment(r))
  let n = keep.length
  while (n > 0 && classifyRow(keep[n - 1] as BillRow) === 'blank' && Object.keys((keep[n - 1] as BillRow).extras).length === 0) n--
  return keep.slice(0, n)
}

const reindex = (rows: BillRow[]): BillRow[] => rows.map((r, i) => (r.idx === i ? r : { ...r, idx: i }))

/**
 * The second table for a GST or non-GST bill (rule 2 / 3): the other layout, item names / qty / rate / total copied as NEW rows, no
 * adjustments. Each copy is paired (`twins`) with its source row so the extra-column cells are shared (rule 7). Returns null when
 * the bill has no GST / non-GST layout. If the bill already has a second table the NEW copy is built from `bill.rows` anyway
 * (callers use `enterHybrid`, which never overwrites).
 */
export function makeSecondTable(bill: Bill, newId: NewId = defaultNewId): HybridSecond | null {
  const side = primarySide(bill)
  if (!side) return null
  const rows: BillRow[] = []
  const twins: Record<Id, Id> = {}
  copyable(bill.rows).forEach((src, i) => {
    const row = copyRow(src, i, {}, newId)
    rows.push(row)
    twins[row.id] = src.id
  })
  return { primary: side, active: false, rows, twins }
}

/**
 * Alt+3 (rule 1-3, 11): turns the Hybrid view on. Creates the second table ONLY when the bill has none; an existing one is never
 * overwritten (use `recopyTable` for that). `formatId` becomes the primary side so the primary rows keep their layout.
 */
export function enterHybrid(bill: Bill, newId: NewId = defaultNewId): { bill: Bill; created: boolean } {
  if (bill.hybrid) {
    if (bill.hybrid.active && bill.formatId === bill.hybrid.primary) return { bill, created: false }
    return { bill: { ...bill, formatId: bill.hybrid.primary, hybrid: { ...bill.hybrid, active: true } }, created: false }
  }
  const second = makeSecondTable(bill, newId)
  if (!second) return { bill, created: false }
  return { bill: { ...bill, formatId: second.primary, hybrid: { ...second, active: true } }, created: true }
}

/**
 * Leaves the Hybrid view (rule 10): the second table is KEPT. `toFormatId` (optional) switches the layout of the primary rows exactly
 * like today's Alt+1 / Alt+2 (`withFormat`); the second table does not follow it.
 */
export function leaveHybrid(bill: Bill, toFormatId?: string): Bill {
  if (!bill.hybrid) return toFormatId ? withFormat(bill, toFormatId) : bill
  const left: Bill = bill.hybrid.active ? { ...bill, hybrid: { ...bill.hybrid, active: false } } : bill
  return toFormatId ? withFormat(left, toFormatId) : left
}

/** The rows of one side. Second-table rows come with their extra cells resolved from the twin (shared cells). Empty for a side the bill does not have. */
export function tableRows(bill: Bill, side: HybridSide): BillRow[] {
  const h = bill.hybrid
  if (!h) return side === primarySide(bill) ? bill.rows : []
  if (side === h.primary) return bill.rows
  const byId = new Map(bill.rows.map((r) => [r.id, r]))
  return h.rows.map((r) => {
    const twin = h.twins[r.id]
    const src = twin ? byId.get(twin) : undefined
    return src ? { ...r, extras: src.extras } : r
  })
}

/** Which side a row id belongs to (null = not in either table). */
export function sideOfRow(bill: Bill, rowId: Id): HybridSide | null {
  const p = primarySide(bill)
  if (bill.rows.some((r) => r.id === rowId)) return p
  if (bill.hybrid?.rows.some((r) => r.id === rowId)) return otherSide(bill.hybrid.primary)
  return null
}

/** Sets (or, with null / an empty unmarked cell, clears) one extra cell. A twinned second-table row writes the PRIMARY row's cell (shared); a row with no twin keeps its own. */
export function setSharedExtra(bill: Bill, rowId: Id, colKey: string, cell: ExtraCell | null): Bill {
  const h = bill.hybrid
  const write = (r: BillRow): BillRow => {
    const extras = { ...r.extras }
    if (!cell || (cell.text === '' && !cell.marked)) delete extras[colKey]
    else extras[colKey] = cell.marked ? { text: cell.text, marked: true } : { text: cell.text }
    return { ...r, extras }
  }
  const secondRow = h?.rows.find((r) => r.id === rowId)
  if (h && secondRow) {
    const twin = h.twins[rowId]
    if (twin && bill.rows.some((r) => r.id === twin)) return { ...bill, rows: bill.rows.map((r) => (r.id === twin ? write(r) : r)) }
    return { ...bill, hybrid: { ...h, rows: h.rows.map((r) => (r.id === rowId ? write(r) : r)) } }
  }
  if (!bill.rows.some((r) => r.id === rowId)) return bill
  return { ...bill, rows: bill.rows.map((r) => (r.id === rowId ? write(r) : r)) }
}

/**
 * Call BEFORE removing primary rows: every second-table row twinned with one of them keeps the shared cells as its own and loses the
 * pairing, so deleting a primary row never loses a cell the other table shows.
 */
export function detachTwinsOf(bill: Bill, primaryRowIds: readonly Id[]): Bill {
  const h = bill.hybrid
  if (!h) return bill
  const gone = new Set(primaryRowIds)
  const byId = new Map(bill.rows.map((r) => [r.id, r]))
  const twins: Record<Id, Id> = {}
  let changed = false
  const rows = h.rows.map((r) => {
    const t = h.twins[r.id]
    if (t === undefined) return r
    if (!gone.has(t)) { twins[r.id] = t; return r }
    changed = true
    const src = byId.get(t)
    return src ? { ...r, extras: cloneExtras(src.extras) } : r
  })
  return changed ? { ...bill, hybrid: { ...h, rows, twins } } : bill
}

/** Drops pairings whose rows no longer exist (after rows were deleted). Never touches a cell. */
export function pruneTwins(bill: Bill): Bill {
  const h = bill.hybrid
  if (!h) return bill
  const primary = new Set(bill.rows.map((r) => r.id))
  const second = new Set(h.rows.map((r) => r.id))
  const twins: Record<Id, Id> = {}
  for (const [s, p] of Object.entries(h.twins)) if (second.has(s) && primary.has(p)) twins[s] = p
  return Object.keys(twins).length === Object.keys(h.twins).length ? bill : { ...bill, hybrid: { ...h, twins } }
}

/** Every second-table row keeps its (resolved) extra cells as its own and the pairing is dropped. */
function materialiseTwins(bill: Bill): Bill {
  const h = bill.hybrid
  if (!h) return bill
  const rows = tableRows(bill, otherSide(h.primary)).map((r) => ({ ...r, extras: cloneExtras(r.extras) }))
  return { ...bill, hybrid: { ...h, rows, twins: {} } }
}

/**
 * The explicit "Re-copy from the other side" (rule 11), the ONLY way a second Alt+3 flow can replace a table. `target` is the table that
 * gets replaced: its non-adjustment rows become fresh copies of the other table's non-adjustment rows; the target's OWN adjustment rows
 * are kept after them. The caller must confirm with the person first. No second table = unchanged.
 */
export function recopyTable(bill: Bill, target: HybridSide, newId: NewId = defaultNewId): Bill {
  if (!bill.hybrid) return bill
  const flat = materialiseTwins(bill)
  const h = flat.hybrid as HybridSecond
  const secondSide = otherSide(h.primary)
  if (target === secondSide) {
    const keptAdj = h.rows.filter(isAdjustment)
    const twins: Record<Id, Id> = {}
    const copies = copyable(flat.rows).map((src, i) => {
      const row = copyRow(src, i, {}, newId)
      twins[row.id] = src.id
      return row
    })
    return { ...flat, hybrid: { ...h, rows: reindex([...copies, ...keptAdj]), twins } }
  }
  // target = the primary table: new primary rows carry the second table's resolved cells; the second rows pair with them.
  const keptAdj = flat.rows.filter(isAdjustment)
  const twins: Record<Id, Id> = {}
  const copies = copyable(h.rows).map((src, i) => {
    const row = copyRow(src, i, cloneExtras(src.extras), newId)
    twins[src.id] = row.id
    return row
  })
  return { ...flat, rows: reindex([...copies, ...keptAdj]), hybrid: { ...h, twins } }
}

export interface HybridTotals {
  primarySide: HybridSide
  secondSide: HybridSide
  /** The primary table, in its own layout. */
  primary: BillTotals
  /** The second table, in the other layout, with its own adjustments / round-off / final total. */
  second: BillTotals
}

/** Each table is calculated on its own (rule 4): its own format, adjustments and final total; `roundOff`, footer cells and tail rows are bill-level and apply to each side separately. Null when there is no second table. */
export function computeHybrid(bill: Bill): HybridTotals | null {
  const h = bill.hybrid
  if (!h) return null
  const opts = getBillOptions(bill)
  const secondSide = otherSide(h.primary)
  return {
    primarySide: h.primary, secondSide,
    primary: computeBill(getFormat(h.primary), bill.rows, opts),
    second: computeBill(getFormat(secondSide), tableRows(bill, secondSide), opts)
  }
}

/** Short text for lists / diffs: "none", "GST + Non-GST (4 rows), view on". */
export function describeHybrid(h: HybridSecond | undefined): string {
  if (!h) return 'none'
  const label = (s: HybridSide): string => (s === 'gst' ? 'GST' : 'Non-GST')
  const n = h.rows.filter((r) => classifyRow(r) !== 'blank').length
  return `${label(h.primary)} + ${label(otherSide(h.primary))} (${n} row${n === 1 ? '' : 's'} on the second table), view ${h.active ? 'on' : 'off'}`
}
