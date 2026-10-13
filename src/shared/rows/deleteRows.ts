import type { BillRow, Id } from '../types'
import { createEmptyRow } from '../billModel'

/**
 * Phase 122 (D-K13) - delete item rows, extras stay. Pure.
 *
 * The body rows (`bodyIds`, display order) are POSITIONS. Removing a row moves the ITEM cells of every later body row up one position
 * (name runs + per-word formatting, qty, rate, manual total, GST %, highlights of item columns); the positions keep their own id, idx and
 * extra-column cells (extras are free cells that live on row positions, same rule as reordering). The positions freed at the bottom
 * become blank item cells. Adjustment rows are not in `bodyIds`, so they never move and cannot be deleted here.
 * Returns the new rows array (same length, same ids), or null when no listed id is a body row.
 */
export function deleteItemRows(rows: readonly BillRow[], bodyIds: readonly Id[], removeIds: ReadonlySet<Id>, extraKeys: ReadonlySet<string>): BillRow[] | null {
  const index = new Map(rows.map((r, i) => [r.id, i]))
  const positions = bodyIds.map((id) => index.get(id)).filter((i): i is number => i !== undefined)
  if (positions.length !== bodyIds.length) return null
  const removed = bodyIds.filter((id) => removeIds.has(id))
  if (removed.length === 0) return null
  const keep = positions.filter((_, k) => !removeIds.has(bodyIds[k] as Id))
  const out = rows.slice()
  const blank = createEmptyRow(0, () => 'x')
  positions.forEach((pos, k) => {
    const dst = rows[pos] as BillRow
    const srcPos = keep[k]
    const src = srcPos === undefined ? null : (rows[srcPos] as BillRow)
    if (src !== null && srcPos === pos) return // nothing before it was removed: untouched
    // extras and their highlights stay with the position
    const styleOf = (r: BillRow | null, wantExtra: boolean): Record<string, { hl?: 1 }> => {
      const o: Record<string, { hl?: 1 }> = {}
      for (const [key, v] of Object.entries(r?.cellStyle ?? {})) if (extraKeys.has(key) === wantExtra) o[key] = v
      return o
    }
    const style = { ...styleOf(src, false), ...styleOf(dst, true) }
    const next: BillRow = {
      id: dst.id, idx: dst.idx, extras: dst.extras,
      nameRuns: src ? src.nameRuns : blank.nameRuns, qty: src ? src.qty : null, rate: src ? src.rate : null,
      totalOverride: src ? src.totalOverride : null, gstRate: src ? src.gstRate : null
    }
    if (Object.keys(style).length > 0) next.cellStyle = style
    out[pos] = next
  })
  return out
}
