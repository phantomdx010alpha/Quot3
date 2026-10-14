import { applyPatches, enablePatches, produceWithPatches, setAutoFreeze, type Patch } from 'immer'
import { isEntryBlank } from '../gridModel'
import { cleanFooterExtras, cleanTailRows } from '../billModel'
import type { BillRow, ExtraColDef, FooterExtras, HybridSecond, IsoDate, PartySnapshot, TailRow } from '../types'

/**
 * Phase 17 — the part of an open bill that undo/redo covers (UNDO_REDO_RULES §2.1). Later phases extend this with party
 * fields / paper override (the doc is the single list of undoable state). Derived values are never in here.
 */
export interface BillDoc {
  formatId: string
  extraCols: ExtraColDef[]
  rows: BillRow[]
  /** Phase 25: the party/detail bar. */
  party: PartySnapshot
  billDate: IsoDate
  /** Phase 79: free extra cells on the footer rows and extra-only tail rows (absent = none). Undoable like rows. */
  footerExtras?: FooterExtras
  tailRows?: TailRow[]
  /** Phase 151: the Hybrid second table (rows, pairings, view on / off; absent = a normal bill). Undoable like rows, so entering Hybrid is ONE undo step. */
  hybrid?: HybridSecond
}

enablePatches()
setAutoFreeze(false) // rows are shared with the store's cached calc (WeakMap keyed by row object) — never freeze them

function sameRef(a: BillDoc, b: BillDoc): boolean {
  return a.formatId === b.formatId && a.extraCols === b.extraCols && a.rows === b.rows && a.party === b.party && a.billDate === b.billDate
    && a.footerExtras === b.footerExtras && a.tailRows === b.tailRows && a.hybrid === b.hybrid
}

/** Row-level patches turning `before` into `after` (+ the inverse). Only changed rows / length produce patches. */
export function diffDocs(before: BillDoc, after: BillDoc): { patches: Patch[]; inverse: Patch[] } {
  if (sameRef(before, after)) return { patches: [], inverse: [] }
  const [, patches, inverse] = produceWithPatches(before, (d) => {
    if (after.formatId !== before.formatId) d.formatId = after.formatId
    if (after.extraCols !== before.extraCols) d.extraCols = after.extraCols
    if (after.party !== before.party) d.party = after.party
    if (after.billDate !== before.billDate) d.billDate = after.billDate
    if (after.footerExtras !== before.footerExtras) d.footerExtras = after.footerExtras
    if (after.tailRows !== before.tailRows) d.tailRows = after.tailRows
    if (after.hybrid !== before.hybrid) d.hybrid = after.hybrid
    if (after.rows !== before.rows) {
      const a = after.rows
      const b = before.rows
      const n = Math.min(a.length, b.length)
      for (let i = 0; i < n; i++) if (a[i] !== b[i]) d.rows[i] = a[i] as BillRow
      for (let i = n; i < a.length; i++) d.rows.push(a[i] as BillRow)
      if (a.length < b.length) d.rows.length = a.length
    }
  })
  return { patches, inverse }
}

export function applyDocPatches(doc: BillDoc, patches: Patch[]): BillDoc {
  return patches.length === 0 ? doc : applyPatches(doc, patches)
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    if (a.length !== bb.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], bb[i])) return false
    return true
  }
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}

/** Exact deep equality (blank padding rows count). */
export function docsIdentical(a: BillDoc, b: BillDoc): boolean {
  return sameRef(a, b) || deepEqual(a, b)
}

function trimBlankTail(rows: readonly BillRow[]): readonly BillRow[] {
  let n = rows.length
  while (n > 0 && isEntryBlank(rows[n - 1] as BillRow)) n--
  return n === rows.length ? rows : rows.slice(0, n)
}

/**
 * Dirty tracking (UR §2.7): equal on the PERSISTED fields — trailing blank padding rows are ignored (saving trims them),
 * `idx` is ignored (it is derived from position). Row objects that are identical are skipped without a deep compare.
 */
export function docsEqualPersisted(a: BillDoc, b: BillDoc): boolean {
  if (a.formatId !== b.formatId) return false
  if (a.billDate !== b.billDate) return false
  if (a.party !== b.party && !deepEqual(a.party, b.party)) return false
  if (a.extraCols !== b.extraCols && !deepEqual(a.extraCols, b.extraCols)) return false
  // Phase 79: compared as they will be stored (empty cells / trailing blank tail rows are no change).
  if (a.footerExtras !== b.footerExtras && !deepEqual(cleanFooterExtras(a.footerExtras) ?? null, cleanFooterExtras(b.footerExtras) ?? null)) return false
  if (a.tailRows !== b.tailRows && !deepEqual(cleanTailRows(a.tailRows) ?? null, cleanTailRows(b.tailRows) ?? null)) return false
  if (a.hybrid !== b.hybrid && !sameHybridPersisted(a.hybrid, b.hybrid)) return false
  return sameRowsPersisted(a.rows, b.rows)
}

/** Rows equal as stored: trailing blank padding and `idx` ignored. */
function sameRowsPersisted(a: readonly BillRow[], b: readonly BillRow[]): boolean {
  if (a === b) return true
  const ra = trimBlankTail(a)
  const rb = trimBlankTail(b)
  if (ra.length !== rb.length) return false
  for (let i = 0; i < ra.length; i++) {
    const x = ra[i] as BillRow
    const y = rb[i] as BillRow
    if (x === y) continue
    const { idx: _xi, ...xr } = x
    const { idx: _yi, ...yr } = y
    if (!deepEqual(xr, yr)) return false
  }
  return true
}

/** Phase 151: the second table as stored (side, view flag, pairings, rows without blank padding). */
function sameHybridPersisted(a: HybridSecond | undefined, b: HybridSecond | undefined): boolean {
  if (!a || !b) return false // one side has no second table: different (both absent was caught by the identity check)
  if (a.primary !== b.primary || a.active !== b.active) return false
  if (a.twins !== b.twins && !deepEqual(a.twins, b.twins)) return false
  return sameRowsPersisted(a.rows, b.rows)
}
