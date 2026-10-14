import { create } from 'zustand'
import { resolveFormat } from '@shared/format/registry'
import { deleteItemRows } from '@shared/rows/deleteRows'
import { moveDestination, moveItemRow, type MoveTarget } from '@shared/rows/moveRows'
import { ensureTrailingBlankRows, buildGridView, EMPTY_VIEW, type GridView } from '@shared/gridModel'
import { normalizeBill, createEmptyRow } from '@shared/billModel'
import { getBillOptions } from '@shared/calc/billOptions'
import { applyCellText } from '@shared/gridEdit'
import { buildGridColumns, type GridColumn } from '@shared/gridModel'
import type { Bill, BillRow, ExtraColDef, FooterExtras, HybridSecond, HybridSide, Id, IsoDate, IsoDateTime, PartySnapshot, Runs, TailRow } from '@shared/types'
import { enterHybrid as enterHybridPure, leaveHybrid as leaveHybridPure, recopyTable, canHybrid, otherSide } from '@shared/hybrid/hybrid'
import { deleteSecondRows, editSecondCells, moveSecondRow, resetSecondTotal, resolveSecondRows, setSecondNameRuns, toggleSecondMark, type TwoTables } from '@shared/hybrid/secondEdit'
import type { SaveBillResponse } from '@shared/ipc'
import { PARTY_FIELDS, PARTY_FIELD_LABEL, isValidBillDate, withPartyField, type PartyField } from '@shared/partyFields'
import { runsEqual } from '@shared/richtext/runs'
import { getFormat } from '@shared/format/registry'
import type { BillDoc } from '@shared/history/billDoc'
import type { HistoryEntry } from '@shared/history/undoStack'
import { createBillHistory, INITIAL_HISTORY_FLAGS, type HistoryFlags } from './billHistory'
import { historyHooks } from './historyHooks'
import { applyFreeCellTexts, isFreeRowId, stripFreeColumn, toggleFreeMark } from '@shared/freeCells'
import { toggleMarkCell, addExtraCol as addExtraColPure, removeExtraCol as removeExtraColPure, renameExtraCol as renameExtraColPure } from '@shared/extraCols'

/**
 * Phase 9 skeleton of the bill store. Holds the working rows + a derived `view` (see gridModel). Cells subscribe to
 * single strings inside `view` (per-cell selectors), so changing one cell re-renders that cell (and any derived cell
 * whose text changed) plus the footer — never the whole grid.
 *
 * Phase 13: `view` is rebuilt by `computeBill`, which reuses the cached per-row result (`calcRowCached`) for every row
 * object that did not change — only the edited row is recalculated, then the footer is re-summed. No persistence, undo or dirty tracking yet (Phases 17/27/29).
 */
/** Phase 27: bill fields that are not edited on the Create page and are not undoable (they come from / go back to the database). */
export interface BillMeta {
  branchId: string
  partyId: Id | null
  poSeq: number
  revision: number
  createdAt: IsoDateTime
  paperOverride: 'A4' | 'A5' | null
  /** Phase 77: the bill's round-off flag (absent = 0). Not undoable; stamped by the server on save. */
  roundOff?: 0 | 1
}
/** Phase 79: the one options read for the open bill = the round-off flag (meta) + the tail rows (undoable state). */
const opts = (s: { meta: BillMeta; tailRows?: TailRow[] }): ReturnType<typeof getBillOptions> => getBillOptions({ roundOff: s.meta.roundOff, tailRows: s.tailRows })
const NEW_META: BillMeta = { branchId: 'local', partyId: null, poSeq: 0, revision: 1, createdAt: '', paperOverride: null }

/** Phase 151: what a grid needs of ONE table. The primary table is the store state itself; the second table is `second`. */
export interface TableState {
  rows: BillRow[]
  view: GridView
  formatId: string
  extraCols: ExtraColDef[]
  footerExtras?: FooterExtras
  tailRows?: TailRow[]
}

interface BillState {
  billId: Id | null
  formatId: string
  extraCols: ExtraColDef[]
  rows: BillRow[]
  /** Phase 25: party/detail bar state (undoable; part of `BillDoc`). `poNumber` is display-only: '' until the save allocates one (Phase 27). */
  party: PartySnapshot
  billDate: IsoDate
  /** Phase 79 (undoable, part of `BillDoc`): free extra cells on the footer rows / extra-only tail rows below the Final total. Absent = none. */
  footerExtras?: FooterExtras
  tailRows?: TailRow[]
  /** Phase 151 (undoable, part of `BillDoc`): the Hybrid second table. Absent = a normal bill. `rows` stays the PRIMARY table. */
  hybrid?: HybridSecond
  /** Phase 151: the second table as the grid shows it (resolved shared extras, own calc view) - derived from `hybrid` on every write, null when there is none. */
  second: TableState | null
  poNumber: string
  /** Phase 27: non-undoable bill fields (branch, party link, PO sequence, revision, created-at, paper override). */
  meta: BillMeta
  /** Phase 27: the whole bill as it stands now (rows include the grid's trailing blank padding; `prepareBillForSave` trims it). */
  toBill: () => Bill
  /** Phase 27: record what `bills:save` returned (PO number, revision, party link). Does NOT touch the saved snapshot — call `markSaved()` after. */
  applySaved: (result: SaveBillResponse) => void
  view: GridView
  /** Phase 25: edit one party field (sanitised; one undo entry per burst of typing in that field). Returns whether anything changed. */
  setPartyField: (field: PartyField, value: string) => boolean
  /** Phase 26: pick a saved party — name, phone, transport and address are ALL replaced by the party's values as ONE undo entry. Returns whether anything changed. */
  applyParty: (party: PartySnapshot) => boolean
  /** Phase 79: replace the footer free cells / the tail rows as ONE undo entry (cleaning and trimming happen on save). Returns whether anything changed. UI is Phase 80. */
  setFooterExtras: (next: FooterExtras | undefined) => boolean
  setTailRows: (next: TailRow[] | undefined) => boolean
  /** Phase 80: type into free cells (`fx:<key>` total rows, `tr:<n>` tail rows) as ONE undo entry; empty + unmarked cells vanish, trailing empty tail rows are trimmed. Returns whether anything changed. */
  setFreeCells: (cells: ReadonlyArray<{ rowId: Id; colKey: string; text: string }>) => boolean
  /** Phase 25: change the bill date (must be a real YYYY-MM-DD; anything else is rejected). Returns whether anything changed. */
  setBillDate: (date: string) => boolean
  loadBill: (bill: Bill) => void
  /**
   * Phase 29: open a recovered draft. `baseline` is what "saved" means for it (the stored bill for an edit, an empty bill for
   * one that was never saved): history starts empty, but the bill is DIRTY against the baseline, so the unsaved-changes guard
   * and the autosave keep protecting it until it is saved or discarded.
   */
  loadDraft: (draft: Bill, baseline: Bill) => void
  /** Dev/skeleton hook: swap the active format (rows untouched). The real switch UI/shortcuts are Phase 20. */
  setFormatId: (formatId: string) => void
  /** Phase 151 (Alt+3): turn the side-by-side Hybrid view on, creating the second table ONLY when the bill has none (never overwrites). One undo entry. Returns 'created' / 'shown' / 'already' (view was on) / null (the format cannot be Hybrid). */
  enterHybridView: () => 'created' | 'shown' | 'already' | null
  /** Phase 151: turn the Hybrid view off (the second table is KEPT); optionally switch the primary rows' layout like Alt+1 / Alt+2. One undo entry. False when nothing changed. */
  leaveHybridView: (toFormatId?: string) => boolean
  /** Phase 151: the explicit "Re-copy from the other side" - replaces `target` table's items with fresh copies of the other table's (the target's own adjustments are kept). The UI confirms first. */
  recopyTable: (target: HybridSide) => boolean
  /** Phase 151: the same edits as the primary table, for the SECOND table (shared extra cells go to the primary twin). */
  setSecondCellTexts: (cells: ReadonlyArray<{ rowId: Id; colKey: string; text: string; runs?: Runs }>) => boolean
  setSecondNameRuns: (rowId: Id, runs: Runs) => boolean
  resetSecondTotal: (rowId: Id) => boolean
  toggleSecondMark: (rowId: Id, colKey: string) => boolean | null
  deleteSecondRows: (rowIds: readonly Id[]) => boolean
  moveSecondRow: (rowId: Id, target: MoveTarget) => number | null
  ensureSecondBodyRows: (count: number) => void
  /** Replace one row by merging a patch (immutable; other rows keep identity). */
  patchRow: (rowId: Id, patch: Partial<Omit<BillRow, 'id'>>) => void
  /** Phase 11: commit typed text into one cell (invalid numeric drafts are rejected → no change). Returns whether anything changed. */
  setCellText: (rowId: Id, colKey: string, text: string) => boolean
  /** Phase 11: set many cells in ONE store update (range clear). Same rules as setCellText. */
  setCellTexts: (cells: ReadonlyArray<{ rowId: Id; colKey: string; text: string; runs?: Runs }>) => boolean
  /** Phase 122 (D-K13): delete whole item rows (body rows only): later item cells move up, extra-column cells stay on their positions. ONE history entry. */
  deleteRows: (rowIds: readonly Id[]) => boolean
  /** Phase 123 (D-K14): move one item row up / down / to top / to bottom; extras stay on their positions. ONE history entry. Returns the row's new body index, or null when nothing moved. */
  moveRow: (rowId: Id, target: MoveTarget) => number | null
  /** Phase 15: replace one row's item-name runs (formatting commands). Returns whether anything changed. */
  setNameRuns: (rowId: Id, runs: Runs) => boolean
  /** Phase 13: drop a row's manual Total override so it is auto (qty × rate) again. Returns whether anything changed. */
  resetTotal: (rowId: Id) => boolean
  /** Phase 21: append an extra column (default header "Col N"); returns its key, or null at the cap. One undoable entry. */
  addExtraCol: () => string | null
  /** Phase 21: remove an extra column AND its cells; the undo entry restores header + every cell. Returns whether anything changed. */
  removeExtraCol: (key: string) => boolean
  /** Phase 21: rename an extra column's header (single line; empty/unchanged = no-op). Returns whether anything changed. */
  renameExtraCol: (key: string, header: string) => boolean
  /** Phase 22: Mark / Unmark an extra-column cell (one undoable entry). Returns true=now marked, false=now unmarked, null=nothing done (unknown row/column). */
  toggleMark: (rowId: Id, colKey: string) => boolean | null
  /** Phase 11: make sure at least `count` body rows exist (Tab/Enter past the last row). */
  ensureBodyRows: (count: number) => void
  // ----- Phase 17: bill-wide undo/redo (UNDO_REDO_RULES §2) -----
  canUndo: boolean
  canRedo: boolean
  /** Label of the entry Ctrl+Z / Ctrl+Y would act on (tooltips: "Undo: Paste"). */
  undoLabel: string | null
  redoLabel: string | null
  /** True iff the persisted fields differ from the last saved snapshot (deep-equal; undoing back to it clears it). */
  dirty: boolean
  historyVersion: number
  undo: () => boolean
  redo: () => boolean
  /** Move so history entries 0..index are applied (-1 = as opened). Phase 18's panel calls this. */
  jumpTo: (index: number) => boolean
  /** Oldest → newest, applied entries first then redo entries; `historyCursor()` = how many are applied. */
  historyList: () => HistoryEntry[]
  historyCursor: () => number
  /** The current state is the saved snapshot (Phase 27). History is kept — you can undo past a save (D-U2). */
  markSaved: () => void
  /** Phase 18: revert to the saved snapshot as ONE (undoable) entry; false when already clean. */
  revertToSaved: () => boolean
  /** Phase 18 registration hook: later phases (party bar, extra columns, paper override) run their mutation through this so it becomes ONE labelled entry. `key` coalesces repeats. */
  recordChange: <T>(label: string, mutate: () => T, key?: string) => T
  /** Next change starts a new undo entry even in the same cell (e.g. a non-character key). */
  breakCoalesce: () => void
}

type NewKeys = 'canUndo' | 'canRedo' | 'undoLabel' | 'redoLabel' | 'dirty' | 'historyVersion' | 'undo' | 'redo' | 'jumpTo' | 'historyList' | 'historyCursor' | 'markSaved' | 'revertToSaved' | 'recordChange' | 'breakCoalesce'

function gridColumn(formatId: string, extraCols: ExtraColDef[], key: string): GridColumn | undefined {
  return buildGridColumns(resolveFormat(formatId), extraCols).find((c) => c.key === key)
}

/** Phase 151: the second table is padded with trailing blank rows for display, like the primary one (`prepareBillForSave` trims them). */
const padHybrid = (h: HybridSecond | undefined): HybridSecond | undefined => (h ? { ...h, rows: ensureTrailingBlankRows(h.rows) } : undefined)

/** Phase 151: the second table's grid state, derived from the stored fields (same object when there is no second table → null). */
function deriveSecond(s: Pick<BillState, 'hybrid' | 'rows' | 'extraCols' | 'footerExtras' | 'tailRows' | 'meta'>, prev: TableState | null): TableState | null {
  const h = s.hybrid
  if (!h) return null
  const formatId = otherSide(h.primary)
  const rows = resolveSecondRows(s.rows, h)
  return { rows, formatId, extraCols: s.extraCols, footerExtras: s.footerExtras, tailRows: s.tailRows, view: buildGridView(resolveFormat(formatId), rows, prev?.view ?? EMPTY_VIEW, opts(s)) }
}

export const useBillStore = create<BillState>((rawSet, get) => {
  /**
   * Phase 151: every write goes through here so `second` is re-derived IN THE SAME update whenever something it depends on changed
   * (second rows, primary rows = shared extras, columns, free cells, tail rows, round-off). One notification, never a stale second table.
   */
  const set = (partial: Partial<BillState> | ((s: BillState) => Partial<BillState>)): void => rawSet((s) => {
    const p = typeof partial === 'function' ? partial(s) : partial
    if ('second' in p) return p
    const n = { ...s, ...p }
    if (!n.hybrid) return s.second === null ? p : { ...p, second: null }
    const stale = n.hybrid !== s.hybrid || n.rows !== s.rows || n.extraCols !== s.extraCols || n.footerExtras !== s.footerExtras || n.tailRows !== s.tailRows || n.meta.roundOff !== s.meta.roundOff
    return stale || !s.second ? { ...p, second: deriveSecond(n, s.second) } : p
  })
  const doc = (): BillDoc => { const s = get(); return { formatId: s.formatId, extraCols: s.extraCols, rows: s.rows, party: s.party, billDate: s.billDate, ...(s.footerExtras ? { footerExtras: s.footerExtras } : {}), ...(s.tailRows ? { tailRows: s.tailRows } : {}), ...(s.hybrid ? { hybrid: s.hybrid } : {}) } }
  const bh = createBillHistory({
    getDoc: doc,
    applyDoc: (d) => {
      const rows = ensureTrailingBlankRows(d.rows)
      set({ formatId: d.formatId, extraCols: d.extraCols, party: d.party, billDate: d.billDate, footerExtras: d.footerExtras, tailRows: d.tailRows, hybrid: d.hybrid, rows, view: buildGridView(resolveFormat(d.formatId), rows, get().view, opts({ meta: get().meta, tailRows: d.tailRows })) })
    },
    setFlags: (f: HistoryFlags) => set(f)
  })
  historyHooks.wrap = (label, fn) => bh.wrap(label, fn)
  const rowNo = (rowId: Id): number => get().view.bodyIds.indexOf(rowId) + 1
  const colLabel = (key: string): string => gridColumn(get().formatId, get().extraCols, key)?.label ?? key
  const cellLen = (s: BillState, rowId: Id, key: string): number => (s.view.body[rowId]?.cells[key] ?? '').length
  // Phase 151: second-table helpers (labels, the two-table working pair, writing a result back).
  const secondRowNo = (s: BillState, rowId: Id): number => (s.second?.view.bodyIds.indexOf(rowId) ?? -1) + 1
  const secondColLabel = (s: BillState, key: string): string => (s.second ? gridColumn(s.second.formatId, s.extraCols, key)?.label : undefined) ?? key
  const secondCellLen = (s: BillState, rowId: Id, key: string): number => (s.second?.view.body[rowId]?.cells[key] ?? '').length
  const twoOf = (s: BillState): TwoTables | null => (s.hybrid ? { rows: s.rows, hybrid: s.hybrid } : null)
  /** Writes an edited pair back: the second rows are re-padded; the primary rows (a shared extra cell lives there) are rebuilt only if they changed. */
  const commitTwo = (t: TwoTables): boolean => {
    const s = get()
    const hybrid = padHybrid(t.hybrid) as HybridSecond
    if (t.rows !== s.rows) set({ rows: t.rows, hybrid, view: buildGridView(resolveFormat(s.formatId), t.rows, s.view, opts(s)) })
    else set({ hybrid })
    return true
  }

  const base: Omit<BillState, NewKeys> = {
  billId: null,
  formatId: 'non_gst',
  extraCols: [],
  rows: [],
  party: { name: '', phone: '', address: '', transport: '' },
  billDate: new Date().toISOString().slice(0, 10),
  second: null,
  poNumber: '',
  meta: NEW_META,
  toBill: () => {
    const s = get()
    const m = s.meta
    return {
      id: s.billId ?? '', branchId: m.branchId, poSeq: m.poSeq, poNumber: s.poNumber, partyId: m.partyId, party: s.party,
      formatId: s.formatId, extraCols: s.extraCols, paperOverride: m.paperOverride, billDate: s.billDate, rows: s.rows,
      revision: m.revision, createdAt: m.createdAt, updatedAt: new Date().toISOString(), deletedAt: null, syncState: 'local_only',
      ...(m.roundOff === 1 ? { roundOff: 1 as const } : {}),
      ...(s.footerExtras ? { footerExtras: s.footerExtras } : {}),
      ...(s.tailRows ? { tailRows: s.tailRows } : {}),
      ...(s.hybrid ? { hybrid: s.hybrid } : {})
    }
  },
  applySaved: (r) => set((s) => {
    const meta: BillMeta = { ...s.meta, poSeq: r.poSeq, revision: r.revision, partyId: r.partyId, createdAt: r.createdAt, roundOff: r.roundOff ?? s.meta.roundOff ?? 0 }
    // Phase 77: the server stamped the flag from the setting; show the totals the saved bill will print / copy with.
    const changed = (meta.roundOff ?? 0) !== (s.meta.roundOff ?? 0)
    return { poNumber: r.poNumber, meta, ...(changed ? { view: buildGridView(resolveFormat(s.formatId), s.rows, s.view, getBillOptions(meta)) } : {}) }
  }),
  view: EMPTY_VIEW,
  setPartyField: (field, value) => bh.record(() => {
    const s = get()
    const party = withPartyField(s.party, field, value)
    if (party === s.party) return false
    set({ party })
    return true
  }, () => ({ label: `Edited ${PARTY_FIELD_LABEL[field]}`, key: `party:${field}` })),
  applyParty: (picked) => bh.record(() => {
    let party = get().party
    for (const f of PARTY_FIELDS) party = withPartyField(party, f, picked[f])
    if (party === get().party) return false
    set({ party })
    return true
  }, () => ({ label: `Selected party ${get().party.name}` })),
  setFooterExtras: (next) => bh.record(() => {
    const cur = get().footerExtras
    if (cur === next || (!cur && !next)) return false
    set({ footerExtras: next })
    return true
  }, () => ({ label: 'Edited total row cells', key: 'footerExtras' })),
  setTailRows: (next) => bh.record(() => {
    const cur = get().tailRows
    if (cur === next || (!cur && !next)) return false
    set({ tailRows: next, view: buildGridView(resolveFormat(get().formatId), get().rows, get().view, opts({ meta: get().meta, tailRows: next })) })
    return true
  }, () => ({ label: 'Edited rows below the total', key: 'tailRows' })),
  setFreeCells: (cells) => bh.record(() => {
    const s = get()
    const r = applyFreeCellTexts(s.footerExtras, s.tailRows, cells.filter((c) => s.extraCols.some((x) => x.key === c.colKey)))
    if (!r) return false
    set({ footerExtras: r.footerExtras, tailRows: r.tailRows, view: buildGridView(resolveFormat(s.formatId), s.rows, s.view, opts({ meta: s.meta, tailRows: r.tailRows })) })
    return true
  }, () => {
    const only = cells.length === 1 ? cells[0] : undefined
    return only ? { label: `Typed in ${colLabel(only.colKey)} (below the items)`, key: `free:${only.rowId}:${only.colKey}` } : { label: 'Edited cells below the items' }
  }),
  setBillDate: (date) => bh.record(() => {
    if (!isValidBillDate(date) || date === get().billDate) return false
    set({ billDate: date })
    return true
  }, () => ({ label: 'Changed date' })),
  loadBill: (bill) => {
    const b = normalizeBill(bill)
    const rows = ensureTrailingBlankRows(b.rows)
    set({ billId: b.id, formatId: b.formatId, extraCols: b.extraCols, party: b.party, billDate: b.billDate, footerExtras: b.footerExtras, tailRows: b.tailRows, hybrid: padHybrid(b.hybrid), poNumber: b.poNumber, rows, view: buildGridView(resolveFormat(b.formatId), rows, undefined, getBillOptions(b)),
      meta: { branchId: b.branchId, partyId: b.partyId, poSeq: b.poSeq, revision: b.revision, createdAt: b.createdAt, paperOverride: b.paperOverride, roundOff: b.roundOff === 1 ? 1 : 0 } })
    bh.reset() // Phase 17: a newly opened bill has an empty history and is clean
  },
  loadDraft: (draft, baseline) => {
    get().loadBill(baseline) // history reset + saved snapshot = baseline
    const b = normalizeBill(draft)
    const rows = ensureTrailingBlankRows(b.rows)
    set({ billId: b.id, formatId: b.formatId, extraCols: b.extraCols, party: b.party, billDate: b.billDate, footerExtras: b.footerExtras, tailRows: b.tailRows, hybrid: padHybrid(b.hybrid), poNumber: b.poNumber, rows, view: buildGridView(resolveFormat(b.formatId), rows, undefined, getBillOptions(b)),
      meta: { branchId: b.branchId, partyId: b.partyId, poSeq: b.poSeq, revision: b.revision, createdAt: b.createdAt, paperOverride: b.paperOverride, roundOff: b.roundOff === 1 ? 1 : 0 } })
    bh.refresh() // dirty = differs from the baseline; the (empty) history is untouched
  },
  setFormatId: (formatId) => bh.record(() => {
    const { rows, view } = get()
    set({ formatId, view: buildGridView(resolveFormat(formatId), rows, view, opts(get())) })
  }, () => ({ label: `Switched to ${getFormat(get().formatId).label}` })),
  enterHybridView: () => {
    const s0 = get()
    const bill0 = s0.toBill()
    if (!canHybrid(bill0)) return null
    if (s0.hybrid?.active && s0.formatId === s0.hybrid.primary) return 'already'
    let out: 'created' | 'shown' = 'shown'
    bh.record(() => {
      const r = enterHybridPure(get().toBill())
      out = r.created ? 'created' : 'shown'
      const s = get()
      const formatId = r.bill.formatId
      set({ formatId, hybrid: padHybrid(r.bill.hybrid), view: formatId === s.formatId ? s.view : buildGridView(resolveFormat(formatId), s.rows, s.view, opts(s)) })
    }, () => ({ label: out === 'created' ? 'Switched to Hybrid (second table copied)' : 'Switched to Hybrid' }))
    return out
  },
  leaveHybridView: (toFormatId) => bh.record(() => {
    const s = get()
    if (!s.hybrid) return false
    const bill = leaveHybridPure(s.toBill(), toFormatId)
    if (bill.formatId === s.formatId && bill.hybrid === s.hybrid) return false
    const formatId = bill.formatId
    set({ formatId, hybrid: bill.hybrid, view: formatId === s.formatId ? s.view : buildGridView(resolveFormat(formatId), s.rows, s.view, opts(s)) })
    return true
  }, () => ({ label: 'Left Hybrid (second table kept)' })),
  recopyTable: (target) => bh.record(() => {
    const s = get()
    if (!s.hybrid) return false
    const bill = recopyTable(s.toBill(), target)
    if (bill.rows === s.rows && bill.hybrid === s.hybrid) return false
    const rows = ensureTrailingBlankRows(bill.rows)
    set({ rows, hybrid: padHybrid(bill.hybrid), view: buildGridView(resolveFormat(s.formatId), rows, s.view, opts(s)) })
    return true
  }, () => ({ label: `Re-copied the ${target === 'gst' ? 'GST' : 'Non-GST'} table from the other side` })),
  setSecondCellTexts: (cells) => {
    const before = get()
    const lenBefore = cells.length === 1 ? secondCellLen(before, (cells[0] as { rowId: Id }).rowId, (cells[0] as { colKey: string }).colKey) : 0
    return bh.record(() => {
      const s = get()
      const t = twoOf(s)
      if (!t || !s.second) return false
      const cols = buildGridColumns(resolveFormat(s.second.formatId), s.extraCols)
      const r = editSecondCells(t, cells, cols, (rowId, colKey) => s.second?.view.body[rowId]?.cells[colKey] ?? '')
      return r ? commitTwo(r) : false
    }, () => {
      if (cells.length !== 1) return { label: `Edited ${cells.length} cells (second table)` }
      const c = cells[0] as { rowId: Id; colKey: string }
      const kind = secondCellLen(get(), c.rowId, c.colKey) < lenBefore ? 'del' : 'type'
      const where = `${secondColLabel(get(), c.colKey)} (second table, row ${secondRowNo(get(), c.rowId)})`
      return { label: kind === 'del' ? `Deleted in ${where}` : `Typed in ${where}`, key: `${kind}2:${c.rowId}:${c.colKey}` }
    })
  },
  setSecondNameRuns: (rowId, runs) => bh.record(() => {
    const t = twoOf(get())
    const r = t ? setSecondNameRuns(t, rowId, runs) : null
    return r ? commitTwo(r) : false
  }, () => ({ label: `Formatted Item Name (second table, row ${secondRowNo(get(), rowId)})` })),
  resetSecondTotal: (rowId) => bh.record(() => {
    const t = twoOf(get())
    const r = t ? resetSecondTotal(t, rowId) : null
    return r ? commitTwo(r) : false
  }, () => ({ label: `Reset total (second table, row ${secondRowNo(get(), rowId)})` })),
  toggleSecondMark: (rowId, colKey) => {
    let out: boolean | null = null
    bh.record(() => {
      const t = twoOf(get())
      const r = t ? toggleSecondMark(t, rowId, colKey) : null
      if (!r) return
      out = r.marked
      commitTwo(r.t)
    }, () => ({ label: `${out ? 'Marked' : 'Unmarked'} cell in ${secondColLabel(get(), colKey)} (second table, row ${secondRowNo(get(), rowId)})` }))
    return out
  },
  deleteSecondRows: (rowIds) => bh.record(() => {
    const s = get()
    const t = twoOf(s)
    const r = t && s.second ? deleteSecondRows(t, s.second.view.bodyIds, new Set(rowIds), new Set(s.extraCols.map((c) => c.key))) : null
    return r ? commitTwo(r) : false
  }, () => ({ label: rowIds.length === 1 ? 'Deleted row (second table)' : `Deleted ${rowIds.length} rows (second table)` })),
  moveSecondRow: (rowId, target) => {
    let dest: number | null = null
    bh.record(() => {
      const s = get()
      const t = twoOf(s)
      if (!t || !s.second) return false
      const to = moveDestination(s.second.rows, s.second.view.bodyIds, rowId, target)
      if (to === null) return false
      const r = moveSecondRow(t, s.second.view.bodyIds, rowId, to, new Set(s.extraCols.map((c) => c.key)))
      if (!r) return false
      dest = to
      return commitTwo(r)
    }, () => ({ label: `Moved row to ${(dest ?? 0) + 1} (second table)` }))
    return dest
  },
  ensureSecondBodyRows: (count) => {
    const s = get()
    if (!s.hybrid || !s.second) return
    const missing = count - s.second.view.bodyIds.length
    if (missing <= 0) return
    const rows = s.hybrid.rows.slice()
    for (let i = 0; i < missing; i++) rows.push(createEmptyRow(rows.length))
    set({ hybrid: { ...s.hybrid, rows } })
  },
  patchRow: (rowId, patch) => bh.record(() => {
    const s = get()
    const i = s.rows.findIndex((r) => r.id === rowId)
    if (i < 0) return
    const next = s.rows.slice()
    next[i] = { ...(s.rows[i] as BillRow), ...patch }
    const rows = ensureTrailingBlankRows(next)
    set({ rows, view: buildGridView(resolveFormat(s.formatId), rows, s.view, opts(s)) })
  }, () => ({ label: `Edited row ${rowNo(rowId)}` })),
  setCellText: (rowId, colKey, text) => get().setCellTexts([{ rowId, colKey, text }]),
  setCellTexts: (cells) => {
    const before = get()
    const lenBefore = cells.length === 1 ? cellLen(before, (cells[0] as { rowId: Id }).rowId, (cells[0] as { colKey: string }).colKey) : 0
    return bh.record(() => setCellTextsRaw(cells), () => {
      if (cells.length !== 1) return { label: `Edited ${cells.length} cells` }
      const c = cells[0] as { rowId: Id; colKey: string; text: string }
      // typing and deleting coalesce separately (UR §2.3): a shorter result than before = a delete run
      const kind = cellLen(get(), c.rowId, c.colKey) < lenBefore ? 'del' : 'type'
      const where = `${colLabel(c.colKey)} (row ${rowNo(c.rowId)})`
      return { label: kind === 'del' ? `Deleted in ${where}` : `Typed in ${where}`, key: `${kind}:${c.rowId}:${c.colKey}` }
    })
  },
  deleteRows: (rowIds) => bh.record(() => {
    const s = get()
    const next = deleteItemRows(s.rows, s.view.bodyIds, new Set(rowIds), new Set(s.extraCols.map((c) => c.key)))
    if (!next) return false
    const rows = ensureTrailingBlankRows(next)
    set({ rows, view: buildGridView(resolveFormat(s.formatId), rows, s.view, opts(s)) })
    return true
  }, () => ({ label: rowIds.length === 1 ? 'Deleted row' : `Deleted ${rowIds.length} rows` })),
  moveRow: (rowId, target) => {
    let dest: number | null = null
    bh.record(() => {
      const s = get()
      const to = moveDestination(s.rows, s.view.bodyIds, rowId, target)
      if (to === null) return false
      const next = moveItemRow(s.rows, s.view.bodyIds, rowId, to, new Set(s.extraCols.map((c) => c.key)))
      if (!next) return false
      dest = to
      const rows = ensureTrailingBlankRows(next)
      set({ rows, view: buildGridView(resolveFormat(s.formatId), rows, s.view, opts(s)) })
      return true
    }, () => ({ label: `Moved row to ${(dest ?? 0) + 1}` }))
    return dest
  },
  setNameRuns: (rowId, runs) => bh.record(() => setNameRunsRaw(rowId, runs), () => ({ label: `Formatted Item Name (row ${rowNo(rowId)})` })),
  resetTotal: (rowId) => bh.record(() => resetTotalRaw(rowId), () => ({ label: `Reset total (row ${rowNo(rowId)})` })),
  addExtraCol: () => {
    let key: string | null = null
    bh.record(() => {
      const s = get()
      const r = addExtraColPure(s.extraCols, s.rows)
      if (!r) return
      key = r.col.key
      set({ extraCols: r.extraCols })
    }, () => ({ label: `Added column '${get().extraCols.find((c) => c.key === key)?.header ?? ''}'` }))
    return key
  },
  removeExtraCol: (key) => {
    let name = ''
    return bh.record(() => {
      const s = get()
      const r = removeExtraColPure(s.extraCols, s.rows, key)
      if (!r) return false
      name = r.removed.header
      const rows = ensureTrailingBlankRows(r.rows)
      // Phase 80: the column's free cells (total rows, tail rows) go with it, so a re-added column never resurrects them.
      const free = stripFreeColumn(s.footerExtras, s.tailRows, key)
      // Phase 151: the second table's own cells of that column go too (shared cells lived on the primary rows).
      const hy = s.hybrid ? (removeExtraColPure(s.extraCols, s.hybrid.rows, key)?.rows ?? s.hybrid.rows) : null
      set({ extraCols: r.extraCols, rows, footerExtras: free.footerExtras, tailRows: free.tailRows, ...(s.hybrid && hy ? { hybrid: { ...s.hybrid, rows: hy } } : {}), view: buildGridView(resolveFormat(s.formatId), rows, s.view, opts({ meta: s.meta, tailRows: free.tailRows })) })
      return true
    }, () => ({ label: `Removed column '${name}'` }))
  },
  renameExtraCol: (key, header) => {
    let from = ''
    return bh.record(() => {
      const s = get()
      const next = renameExtraColPure(s.extraCols, key, header)
      if (!next) return false
      from = s.extraCols.find((c) => c.key === key)?.header ?? ''
      set({ extraCols: next })
      return true
    }, () => ({ label: `Renamed column '${from}' to '${get().extraCols.find((c) => c.key === key)?.header ?? ''}'` }))
  },
  toggleMark: (rowId, colKey) => {
    let out: boolean | null = null
    bh.record(() => {
      const s = get()
      if (isFreeRowId(rowId)) {
        if (!s.extraCols.some((c) => c.key === colKey)) return
        const f = toggleFreeMark(s.footerExtras, s.tailRows, rowId, colKey)
        if (!f) return
        out = f.marked
        set({ footerExtras: f.footerExtras, tailRows: f.tailRows, view: buildGridView(resolveFormat(s.formatId), s.rows, s.view, opts({ meta: s.meta, tailRows: f.tailRows })) })
        return
      }
      const i = s.rows.findIndex((r) => r.id === rowId)
      if (i < 0 || !s.extraCols.some((c) => c.key === colKey)) return
      const r = toggleMarkCell(s.rows[i] as BillRow, colKey)
      out = r.marked
      const next = s.rows.slice()
      next[i] = r.row
      const rows = ensureTrailingBlankRows(next)
      set({ rows, view: buildGridView(resolveFormat(s.formatId), rows, s.view, opts(s)) })
    }, () => ({ label: `${out ? 'Marked' : 'Unmarked'} cell in ${colLabel(colKey)} (row ${rowNo(rowId)})` }))
    return out
  },
  ensureBodyRows: (count) => {
    const s = get()
    const missing = count - s.view.bodyIds.length
    if (missing <= 0) return
    const rows = s.rows.slice()
    for (let i = 0; i < missing; i++) rows.push(createEmptyRow(rows.length))
    set({ rows, view: buildGridView(resolveFormat(s.formatId), rows, s.view, opts(s)) })
  }
  }
  function setCellTextsRaw(cells: ReadonlyArray<{ rowId: Id; colKey: string; text: string; runs?: Runs }>): boolean {
    const s = get()
    const cols = buildGridColumns(resolveFormat(s.formatId), s.extraCols)
    const idxById = new Map(s.rows.map((r, i) => [r.id, i]))
    let next: BillRow[] | null = null
    for (const c of cells) {
      const i = idxById.get(c.rowId)
      const col = cols.find((x) => x.key === c.colKey)
      if (i === undefined || !col) continue
      const cur = (next ?? s.rows)[i] as BillRow
      // Phase 16: a Quot3-flavour paste into an item-name cell carries its formatting runs.
      const patch = c.runs && col.key === 'name'
        ? (runsEqual(c.runs, cur.nameRuns) ? null : { nameRuns: c.runs })
        : applyCellText(cur, col, c.text, { display: s.view.body[c.rowId]?.cells[c.colKey] ?? '' })
      if (!patch) continue
      if (!next) next = s.rows.slice()
      next[i] = { ...cur, ...patch }
    }
    if (!next) return false
    const rows = ensureTrailingBlankRows(next)
    set({ rows, view: buildGridView(resolveFormat(s.formatId), rows, s.view, opts(s)) })
    return true
  }
  function setNameRunsRaw(rowId: Id, runs: Runs): boolean {
    const s = get()
    const i = s.rows.findIndex((r) => r.id === rowId)
    const cur = s.rows[i]
    if (!cur || runsEqual(cur.nameRuns, runs)) return false
    const next = s.rows.slice()
    next[i] = { ...cur, nameRuns: runs }
    const rows = ensureTrailingBlankRows(next)
    set({ rows, view: buildGridView(resolveFormat(s.formatId), rows, s.view, opts(s)) })
    return true
  }
  function resetTotalRaw(rowId: Id): boolean {
    const s = get()
    const i = s.rows.findIndex((r) => r.id === rowId)
    const cur = s.rows[i]
    if (!cur || cur.totalOverride === null) return false
    const next = s.rows.slice()
    next[i] = { ...cur, totalOverride: null }
    const rows = ensureTrailingBlankRows(next)
    set({ rows, view: buildGridView(resolveFormat(s.formatId), rows, s.view, opts(s)) })
    return true
  }
  return {
    ...base,
    ...INITIAL_HISTORY_FLAGS,
    undoLabel: null,
    redoLabel: null,
    undo: () => bh.undo(),
    redo: () => bh.redo(),
    jumpTo: (index) => bh.jumpTo(index),
    historyList: () => bh.list(),
    historyCursor: () => bh.cursor(),
    markSaved: () => bh.markSaved(),
    revertToSaved: () => bh.revertToSaved(),
    recordChange: (label, mutate, key) => bh.record(mutate, () => ({ label, ...(key ? { key } : {}) })),
    breakCoalesce: () => bh.breakCoalesce()
  }
})
export { gridColumn }
