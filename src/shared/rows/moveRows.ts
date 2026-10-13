import type { BillRow, Id } from '../types'

/**
 * Phase 123 (D-K14) - move an item row up / down / to top / to bottom. Pure.
 *
 * Same position model as `deleteRows.ts`: the body rows (`bodyIds`, display order) are POSITIONS. Moving a row re-orders the ITEM cells
 * (name runs + per-word formatting, qty, rate, manual total, GST %, highlights of item columns) among the affected positions; every position
 * keeps its own id, idx and extra-column cells (+ their marks and highlights). So extras stay, marked segments / unit counts follow the
 * positions through the existing engine, and the row count never changes. Adjustment rows are not in `bodyIds` and never move.
 * Item rows only travel inside the filled area: a move never goes below the last row that has item content (trailing blank rows stay blank).
 */
export type MoveTarget = 'up' | 'down' | 'top' | 'bottom'

const itemBlank = (r: BillRow): boolean =>
  r.nameRuns.every((x) => x.t === '') && r.qty === null && r.rate === null && r.totalOverride === null && r.gstRate === null

/** The body-order index `rowId` would land on, or null when the move is impossible / does nothing. */
export function moveDestination(rows: readonly BillRow[], bodyIds: readonly Id[], rowId: Id, target: MoveTarget): number | null {
  const from = bodyIds.indexOf(rowId)
  if (from < 0) return null
  const byId = new Map(rows.map((r) => [r.id, r]))
  let last = -1
  bodyIds.forEach((id, i) => { const r = byId.get(id); if (r && !itemBlank(r)) last = i })
  const limit = Math.max(last, from)
  const to = target === 'up' ? from - 1 : target === 'down' ? from + 1 : target === 'top' ? 0 : limit
  const clamped = Math.min(Math.max(to, 0), limit)
  return clamped === from ? null : clamped
}

/** Move the item cells of `rowId` to body index `toIndex`. Returns the new rows array (same length, same ids) or null for a no-op. */
export function moveItemRow(rows: readonly BillRow[], bodyIds: readonly Id[], rowId: Id, toIndex: number, extraKeys: ReadonlySet<string>): BillRow[] | null {
  const index = new Map(rows.map((r, i) => [r.id, i]))
  const positions = bodyIds.map((id) => index.get(id))
  if (positions.some((p) => p === undefined)) return null
  const pos = positions as number[]
  const from = bodyIds.indexOf(rowId)
  if (from < 0 || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= bodyIds.length || toIndex === from) return null
  // perm[k] = which old position's item cells now sit at position k
  const perm = bodyIds.map((_, k) => k)
  perm.splice(from, 1)
  perm.splice(toIndex, 0, from)
  const out = rows.slice()
  const styleOf = (r: BillRow, wantExtra: boolean): Record<string, { hl?: 1 }> => {
    const o: Record<string, { hl?: 1 }> = {}
    for (const [key, v] of Object.entries(r.cellStyle ?? {})) if (extraKeys.has(key) === wantExtra) o[key] = v
    return o
  }
  perm.forEach((srcK, k) => {
    if (srcK === k) return
    const dst = rows[pos[k] as number] as BillRow
    const src = rows[pos[srcK] as number] as BillRow
    const style = { ...styleOf(src, false), ...styleOf(dst, true) }
    const next: BillRow = {
      id: dst.id, idx: dst.idx, extras: dst.extras,
      nameRuns: src.nameRuns, qty: src.qty, rate: src.rate, totalOverride: src.totalOverride, gstRate: src.gstRate
    }
    if (Object.keys(style).length > 0) next.cellStyle = style
    out[pos[k] as number] = next
  })
  return out
}
