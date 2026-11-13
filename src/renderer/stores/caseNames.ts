import { runAsOneEntry } from './historyHooks'
import { useBillStore } from './billStore'
import { nextCaseMode, transformRuns } from '@shared/richtext/caseTransform'
import { plain } from '@shared/richtext/runs'
import type { TableSide } from './tableApi'

/**
 * Phase 234 (M23) - the Case button. Turns the item names of the bill UPPER or lower (cycle: all-UPPER -> lower, otherwise UPPER)
 * as ONE history entry, keeping bold / red / highlight. `scope` = the selected rows of ONE table (a range is selected), or null =
 * the item-name column of every row of the bill, the Hybrid second table included. Only the name runs are written, through the
 * normal row edit, so other columns, totals and sync / print data are never touched.
 */
export function applyCaseToNames(scope: { side: TableSide; ids: readonly string[] } | null): { mode: 'upper' | 'lower'; changed: number } {
  const s = useBillStore.getState()
  const want = scope ? new Set(scope.ids) : null
  const items: { side: TableSide; id: string; runs: import('@shared/types').Runs }[] = []
  const collect = (side: TableSide, rows: ReadonlyArray<{ id: string; nameRuns: import('@shared/types').Runs }>): void => {
    if (scope && scope.side !== side) return
    for (const r of rows) if (!want || want.has(r.id)) items.push({ side, id: r.id, runs: r.nameRuns })
  }
  collect('primary', s.rows)
  collect('second', s.second?.rows ?? [])
  const mode = nextCaseMode(items.map((i) => plain(i.runs)))
  let changed = 0
  runAsOneEntry(mode === 'upper' ? 'Item names to UPPER CASE' : 'Item names to lower case', () => {
    for (const it of items) {
      const next = transformRuns(it.runs, mode)
      if (next === it.runs) continue
      const st = useBillStore.getState()
      if (it.side === 'primary' ? st.setNameRuns(it.id, next) : st.setSecondNameRuns(it.id, next)) changed++
    }
  })
  return { mode, changed }
}
