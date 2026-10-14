// Shared domain types (pure). Mirrors API_CONTRACTS.md §0 and §1 (`FormatDef` stub until Phase 8's registry).

/** Canonical decimal string, e.g. "1250.50". NEVER a JS number. */
export type Dec = string
export type Id = string
export type IsoDateTime = string
export type IsoDate = string

/** Rich-text run: bold, red, highlight. */
export interface Run {
  t: string
  b?: 1
  r?: 1
  hl?: 1
}
export type Runs = Run[]

export interface ExtraColDef {
  key: string
  header: string
  kind: 'units'
}
export interface ExtraCell {
  text: string
  marked?: boolean
}

/** Phase 79 (M8 §7): the three footer rows that can carry free extra-column cells (the single "Total" row is `grandTotal`). */
export type FooterExtraKey = 'itemsTotal' | 'adjustmentsTotal' | 'grandTotal'
export const FOOTER_EXTRA_KEYS: readonly FooterExtraKey[] = ['itemsTotal', 'adjustmentsTotal', 'grandTotal']
/** Free extra-column cells on the footer rows, keyed by extra column key. Absent / empty = none. */
export type FooterExtras = Partial<Record<FooterExtraKey, Record<string, ExtraCell>>>
/** An extra-only row below the Final total (no name / qty / rate). */
export interface TailRow {
  extras: Record<string, ExtraCell>
}

export interface BillRow {
  id: Id
  idx: number
  nameRuns: Runs
  qty: Dec | null
  rate: Dec | null
  /** Non-null = the owner typed the total manually. */
  totalOverride: Dec | null
  gstRate: Dec | null
  extras: Record<string, ExtraCell>
  cellStyle?: Record<string, { hl?: 1 }>
}

export interface PartySnapshot {
  name: string
  phone: string
  address: string
  transport: string
}

export type SyncState = 'local_only' | 'pending' | 'synced' | 'conflict'

/** Phase 150: the two layouts a Hybrid bill can have. They are real format ids. */
export type HybridSide = 'gst' | 'non_gst'

/**
 * Phase 150 (Hybrid format, `API_CONTRACTS.md` "Phase 150 as built"): an optional SECOND row set on a bill. `Bill.rows` stays the
 * primary table (layout `primary`); `rows` here is the second table in the OPPOSITE layout. `twins` maps a second-table row id to
 * the primary row id it was copied from: the extra-column cells of a pair are ONE cell (kept on the primary row).
 * `active` = the side-by-side Hybrid view is on.
 */
export interface HybridSecond {
  primary: HybridSide
  active: boolean
  rows: BillRow[]
  twins: Record<Id, Id>
}

export interface Bill {
  id: Id
  branchId: Id
  poSeq: number
  poNumber: string
  partyId: Id | null
  party: PartySnapshot
  formatId: string
  extraCols: ExtraColDef[]
  paperOverride: 'A4' | 'A5' | null
  billDate: IsoDate
  rows: BillRow[]
  revision: number
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  deletedAt: IsoDateTime | null
  syncState: SyncState
  /** Phase 76: 1 = round the grand total to the nearest rupee (per-bill flag; absent / 0 = exact). Read only via `getBillOptions`. */
  roundOff?: 0 | 1
  /** Phase 79: free extra cells on the footer rows (absent = none). Stored in `bills.footer_extras_json`. */
  footerExtras?: FooterExtras
  /** Phase 79: extra-only rows below the Final total, trimmed to the last non-empty row on save (absent = none). `bills.tail_rows_json`. */
  tailRows?: TailRow[]
  /** Phase 150: the Hybrid second table (absent = a normal bill). Stored in `bills.second_table_json`. */
  hybrid?: HybridSecond
}

export type RowKind = 'blank' | 'item' | 'adjustment' | 'partial'
export type PrintMode = 'rough' | 'professional'
export type Paper = 'A4' | 'A5'

export type ColumnKey = 'slNo' | 'name' | 'qty' | 'rate' | 'total' | 'gstRate' | 'gstAmt' | 'amount'

export interface ColumnDef {
  key: ColumnKey | (string & {})
  label: string
  kind: 'auto' | 'text' | 'richtext' | 'num' | 'derived'
  editable: boolean
  overridable?: boolean
  widthPx: number
  printWidthPct: number
  align: 'left' | 'right' | 'center'
}

/** Phase 6 uses only `columns` and `footer`; the registry (Phase 8) owns the rest. */
export interface FormatDef {
  id: string
  label: string
  shortcut?: string
  isDefault?: boolean
  columns: ColumnDef[]
  a5ExtraColLimit: number
  /** `'none'` (Phase 149, Stock transfer): no money columns, no totals row, no adjustments. */
  footer: 'total' | 'total_gst_amount' | 'none'
  /** Phase 149: `'branch'` = the header asks "Select branch for transfer" instead of the party fields (absent = party). */
  partyMode?: 'party' | 'branch'
  /** Phase 149: the document title printed for formats that are not a quotation (absent = quotation). */
  docTitle?: string
}
