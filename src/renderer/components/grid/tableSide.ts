import { createContext, useContext } from 'react'
import { EMPTY_VIEW } from '@shared/gridModel'
import { useBillStore, type TableState } from '../../stores/billStore'
import type { TableSide } from '../../stores/tableApi'

/** Phase 151: which table a grid (and every row / cell inside it) shows. The default is the primary table = the bill itself. */
export const TableSideContext = createContext<TableSide>('primary')
export const useTableSide = (): TableSide => useContext(TableSideContext)

const NO_TABLE: TableState = { rows: [], view: EMPTY_VIEW, formatId: 'non_gst', extraCols: [] }

/** A per-cell / per-row subscription into the grid's own table: `sel` sees the primary table (the store state) or the second table. */
export function useTable<T>(sel: (t: TableState) => T): T {
  const side = useContext(TableSideContext)
  return useBillStore((s) => sel(side === 'second' ? (s.second ?? NO_TABLE) : s))
}

/** Same as `useTable` but with the side given explicitly: for the grid ROOT, which renders the Provider itself and so cannot read it from context. */
export function useTableOfSide<T>(side: TableSide, sel: (t: TableState) => T): T {
  return useBillStore((s) => sel(side === 'second' ? (s.second ?? NO_TABLE) : s))
}
