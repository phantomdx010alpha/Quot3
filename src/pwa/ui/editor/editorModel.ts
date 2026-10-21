/** Compact bill editor model (Phase 182). Pure: no DOM, no IndexedDB. Everything the editor screen does to the open bill is a function here
 *  so it is tested without a screen. Totals only through shared `computeBill` + `getBillOptions`; formats only through the registry;
 *  rows are a superset, so switching format never touches a row. Unknown fields on a loaded bill (footer extras, tail rows, cell styles,
 *  extra columns) are carried through untouched. */
import '../../../shared/format'
import { createEmptyBill, createEmptyRow, type NewId } from '../../../shared/billModel'
import { getBillOptions } from '../../../shared/calc/billOptions'
import { computeBill } from '../../../shared/calc/billTotals'
import { classifyRow } from '../../../shared/calc/classifyRow'
import { formatHasGst } from '../../../shared/calc/rowCalc'
import { addExtraCol, extraColHasData, removeExtraCol, renameExtraCol, toggleMarkCell } from '../../../shared/extraCols'
import { stripFreeColumn } from '../../../shared/freeCells'
import { applyFormat } from '../../../shared/richtext/format'
import { applyTextChange } from '../../../shared/richtext/runs'
import { summarizeUnits, unitsSummaryToText, type UnitsSummary } from '../../../shared/units'
import { prepareBillForSave, trimTrailingBlankRows, validateBillForSave, type SaveIssue } from '../../../shared/billSave'
import { listFormats, resolveFormat } from '../../../shared/format/registry'
import { partyToSnapshot, type PartyLite } from '../../../shared/party/partyLite'
import type { Bill, BillRow, PartySnapshot } from '../../../shared/types'
import type { SaveBillInput } from '../../data/billsRepo'

export interface EditorState {
  bill: Bill
  /** Ids of the rows shown as adjustments (name + amount). Everything else is an item row. Rows stay one list (a superset). */
  adjIds: readonly string[]
  /** The stored revision this editor opened, or null for a bill never saved. */
  baseRevision: number | null
  /** What "unchanged" looks like (see `signature`). */
  baseline: string
}

const defaultNewId: NewId = () => globalThis.crypto.randomUUID()

/** What counts as a change: party, format, date and the rows without trailing blanks. Blank padding never makes a bill "dirty". */
export function signature(bill: Bill): string {
  return JSON.stringify({ p: bill.party, f: bill.formatId, d: bill.billDate, r: trimTrailingBlankRows(bill.rows), x: bill.extraCols, o: bill.roundOff ?? 0, fx: bill.footerExtras ?? null, tr: bill.tailRows ?? null })
}

const renumber = (rows: readonly BillRow[]): BillRow[] => rows.map((r, i) => (r.idx === i ? r : { ...r, idx: i }))

/** Rows = item rows first, adjustment rows after (the printed order puts adjustments in the footer anyway). */
function arrange(rows: readonly BillRow[], adjIds: readonly string[]): BillRow[] {
  const adj = new Set(adjIds)
  return renumber([...rows.filter((r) => !adj.has(r.id)), ...rows.filter((r) => adj.has(r.id))])
}

export function openNewBill(o: { branchId: string; roundOff: boolean; today: string; newId?: NewId; now?: string }): EditorState {
  const bill = createEmptyBill({ branchId: o.branchId, roundOff: o.roundOff, billDate: o.today, now: o.now, newId: o.newId, rowCount: 1 })
  return { bill, adjIds: [], baseRevision: null, baseline: signature(bill) }
}

/** Opens a stored bill (or a recovered draft). `baseline` is the stored bill, so a recovered draft shows as changed. */
export function openExistingBill(bill: Bill, o: { baseline?: Bill; newId?: NewId } = {}): EditorState {
  const adjIds = bill.rows.filter((r) => classifyRow(r) === 'adjustment').map((r) => r.id)
  const rows = arrange(bill.rows.length > 0 ? bill.rows : [createEmptyRow(0, o.newId ?? defaultNewId)], adjIds)
  const opened: Bill = { ...bill, rows }
  return { bill: opened, adjIds, baseRevision: bill.revision, baseline: signature(o.baseline ?? opened) }
}

/** A recovered draft of a bill never saved: same as a new bill but with the draft's content and everything counted as changed. */
export function openRecoveredNew(draft: Bill, o: { newId?: NewId } = {}): EditorState {
  const s = openExistingBill(draft, o)
  return { ...s, baseRevision: null, baseline: '' }
}

export const isDirty = (s: EditorState): boolean => signature(s.bill) !== s.baseline

// ---------- edits ----------
const withBill = (s: EditorState, bill: Bill, adjIds: readonly string[] = s.adjIds): EditorState => ({ ...s, bill, adjIds })

export function setPartyField(s: EditorState, field: keyof PartySnapshot, value: string): EditorState {
  return withBill(s, { ...s.bill, party: { ...s.bill.party, [field]: value } })
}

/** Picks a saved customer: fills the snapshot (name, phone, address, transport). The link itself is made on save by the exact normalised name. */
export function applyParty(s: EditorState, p: PartyLite): EditorState {
  return withBill(s, { ...s.bill, party: partyToSnapshot(p) })
}

export function setBillDate(s: EditorState, date: string): EditorState {
  return withBill(s, { ...s.bill, billDate: date })
}

/** The formats the phone can edit, from the registry: money formats with a customer (a transfer, whose party is a branch, is read-only here). */
export function editableFormats(): { id: string; label: string }[] {
  return listFormats().filter((f) => f.partyMode !== 'branch').map((f) => ({ id: f.id, label: f.label }))
}

/** Switches the format. Rows are the same array, so nothing entered is lost or reset. */
export function setFormat(s: EditorState, formatId: string): EditorState {
  if (s.bill.formatId === formatId) return s
  if (!editableFormats().some((f) => f.id === formatId)) return s
  return withBill(s, { ...s.bill, formatId })
}

export type ItemField = 'name' | 'qty' | 'rate' | 'gstRate'

const plain = (row: BillRow): string => row.nameRuns.map((r) => r.t).join('')

function patchRow(s: EditorState, id: string, f: (r: BillRow) => BillRow): EditorState {
  let hit = false
  const rows = s.bill.rows.map((r) => (r.id === id ? ((hit = true), f(r)) : r))
  return hit ? withBill(s, { ...s.bill, rows }) : s
}

/** A name edit keeps the styling of every character that was not touched (shared `applyTextChange`); typing inside bold text stays bold. */
export function setItemField(s: EditorState, id: string, field: ItemField, value: string): EditorState {
  return patchRow(s, id, (r) => {
    if (field === 'name') return plain(r) === value ? r : { ...r, nameRuns: applyTextChange(r.nameRuns, value) }
    const v = value === '' ? null : value
    return field === 'qty' ? { ...r, qty: v } : field === 'rate' ? { ...r, rate: v } : { ...r, gstRate: v }
  })
}

/** Appends a blank item row after the last item (before the adjustments). Returns the state and the new row's id. */
export function addItemRow(s: EditorState, newId: NewId = defaultNewId): { state: EditorState; id: string } {
  const row = createEmptyRow(s.bill.rows.length, newId)
  return { state: withBill(s, { ...s.bill, rows: arrange([...s.bill.rows, row], s.adjIds) }), id: row.id }
}

/** Removes a row. The last item row is never removed (it is blanked instead) so there is always one row to type in. */
export function removeRow(s: EditorState, id: string): EditorState {
  const isAdj = s.adjIds.includes(id)
  const items = s.bill.rows.filter((r) => !s.adjIds.includes(r.id))
  if (!isAdj && items.length <= 1 && items[0]?.id === id) {
    return patchRow(s, id, (r) => ({ ...createEmptyRow(r.idx, () => r.id) }))
  }
  const rows = renumber(s.bill.rows.filter((r) => r.id !== id))
  return withBill(s, { ...s.bill, rows }, s.adjIds.filter((a) => a !== id))
}

export function addAdjustment(s: EditorState, newId: NewId = defaultNewId): { state: EditorState; id: string } {
  const row = createEmptyRow(s.bill.rows.length, newId)
  const adjIds = [...s.adjIds, row.id]
  return { state: withBill(s, { ...s.bill, rows: arrange([...s.bill.rows, row], adjIds) }, adjIds), id: row.id }
}

/** Adjustment = name + amount (the amount is the row's total; qty and rate stay empty). Negative amounts are allowed. */
export function setAdjustment(s: EditorState, id: string, p: { name?: string; amount?: string }): EditorState {
  if (!s.adjIds.includes(id)) return s
  return patchRow(s, id, (r) => {
    let n = r
    if (p.name !== undefined && plain(r) !== p.name) n = { ...n, nameRuns: p.name === '' ? [] : [{ t: p.name }] }
    if (p.amount !== undefined) n = { ...n, totalOverride: p.amount === '' ? null : p.amount }
    return n
  })
}

// ---------- Phase 183: override, round-off, rich text, extra columns, units ----------
export type NameFormat = 'bold' | 'redBold'

/** B / R+B on the selected part of the name (no selection = the whole name). Offsets are UTF-16 positions in the name text. */
export function formatName(s: EditorState, id: string, kind: NameFormat, start: number, end: number): EditorState {
  return patchRow(s, id, (r) => {
    const len = plain(r).length
    const [a, b] = start === end ? [0, len] : [Math.min(start, end), Math.max(start, end)]
    return { ...r, nameRuns: applyFormat(r.nameRuns, kind, a, b) }
  })
}

/** A typed line total replaces qty x rate for that row (empty = automatic again). Adjustments use `setAdjustment`. */
export function setTotalOverride(s: EditorState, id: string, value: string): EditorState {
  if (s.adjIds.includes(id)) return s
  return patchRow(s, id, (r) => ({ ...r, totalOverride: value === '' ? null : value }))
}

/** The per-bill round-off flag (read back only through `getBillOptions`). */
export function setRoundOff(s: EditorState, on: boolean): EditorState {
  return withBill(s, { ...s.bill, roundOff: on ? 1 : 0 })
}
export const isRoundOff = (s: EditorState): boolean => s.bill.roundOff === 1

export function addColumn(s: EditorState): { state: EditorState; key: string } | null {
  const r = addExtraCol(s.bill.extraCols, s.bill.rows)
  return r ? { state: withBill(s, { ...s.bill, extraCols: r.extraCols }), key: r.col.key } : null
}

export function renameColumn(s: EditorState, key: string, header: string): EditorState {
  const cols = renameExtraCol(s.bill.extraCols, key, header)
  return cols ? withBill(s, { ...s.bill, extraCols: cols }) : s
}

/** True when removing the column would lose typed text or marks (the screen asks first). */
export function columnHasData(s: EditorState, key: string): boolean {
  return extraColHasData(s.bill.rows, key)
}

/** Drops the column from the bill, every row and the free footer / tail cells. */
export function removeColumn(s: EditorState, key: string): EditorState {
  const r = removeExtraCol(s.bill.extraCols, s.bill.rows, key)
  if (!r) return s
  const free = stripFreeColumn(s.bill.footerExtras, s.bill.tailRows, key)
  const bill: Bill = { ...s.bill, extraCols: r.extraCols, rows: r.rows }
  if (free.footerExtras) bill.footerExtras = free.footerExtras; else delete bill.footerExtras
  if (free.tailRows) bill.tailRows = free.tailRows; else delete bill.tailRows
  return withBill(s, bill)
}

/** Sets the text of one extra cell, keeping its Mark. An empty unmarked cell is dropped. */
export function setExtraCell(s: EditorState, id: string, key: string, text: string): EditorState {
  if (!s.bill.extraCols.some((c) => c.key === key)) return s
  return patchRow(s, id, (r) => {
    const cur = r.extras[key]
    if (text === '' && !cur?.marked) {
      if (!cur) return r
      const { [key]: _gone, ...rest } = r.extras
      return { ...r, extras: rest }
    }
    return { ...r, extras: { ...r.extras, [key]: cur?.marked ? { text, marked: true } : { text } } }
  })
}

/** Mark / Unmark: the cell becomes the label of a new segment (shared rule, D-X1). */
export function toggleMark(s: EditorState, id: string, key: string): EditorState {
  if (!s.bill.extraCols.some((c) => c.key === key)) return s
  return patchRow(s, id, (r) => toggleMarkCell(r, key).row)
}

/** Per-column unit totals and marked segments: the shared engine over the whole bill (rows + footer / tail free cells). */
export function buildUnitsSummary(s: EditorState): UnitsSummary {
  return summarizeUnits(s.bill.rows, s.bill.extraCols, { footerExtras: s.bill.footerExtras, tailRows: s.bill.tailRows })
}
export const unitsText = (sum: UnitsSummary, view: 'units' | 'marked'): string => unitsSummaryToText(sum, view)

// ---------- reading ----------
export interface EditorRowView {
  id: string
  slNo: string
  name: string
  qty: string
  rate: string
  gstRate: string
  /** The computed line total (the Amount column for GST). Empty when the row has no maths yet. */
  amount: string
  /** The typed total ('' = automatic). */
  override: string
  /** Extra-column cells by column key. */
  extras: Record<string, { text: string; marked: boolean }>
  warn: boolean
}
export interface EditorAdjView { id: string; name: string; amount: string }
export interface EditorFooterLine { key: string; label: string; value: string; strong: boolean }
export interface EditorView {
  items: EditorRowView[]
  adjustments: EditorAdjView[]
  footer: EditorFooterLine[]
  grandTotal: string
  hasGst: boolean
}

/** The screen's numbers: one `computeBill` over the whole bill, exactly as desktop. */
export function buildEditorView(s: EditorState): EditorView {
  const format = resolveFormat(s.bill.formatId)
  const totals = computeBill(format, s.bill.rows, getBillOptions(s.bill))
  const cellsById = new Map(totals.display.filter((d) => d.rowId).map((d) => [d.rowId as string, d]))
  const adj = new Set(s.adjIds)
  const items: EditorRowView[] = s.bill.rows.filter((r) => !adj.has(r.id)).map((r) => {
    const d = cellsById.get(r.id)
    return {
      id: r.id, slNo: d?.slNo ? String(d.slNo) : '', name: plain(r), qty: r.qty ?? '', rate: r.rate ?? '', gstRate: r.gstRate ?? '',
      amount: d?.cells['amount'] || d?.cells['total'] || '', override: r.totalOverride ?? '',
      extras: Object.fromEntries(s.bill.extraCols.map((c) => [c.key, { text: r.extras[c.key]?.text ?? '', marked: r.extras[c.key]?.marked === true }])), warn: totals.warnings.some((w) => w.endsWith(`:${r.id}`))
    }
  })
  const adjustments: EditorAdjView[] = s.bill.rows.filter((r) => adj.has(r.id)).map((r) => ({ id: r.id, name: plain(r), amount: r.totalOverride ?? '' }))
  const footer: EditorFooterLine[] = []
  for (const d of totals.display) {
    if (d.kind === 'itemsTotal' || d.kind === 'adjustmentsTotal' || d.kind === 'grandTotal' || d.kind === 'roundOff') {
      footer.push({ key: d.kind, label: d.cells['name'] ?? '', value: d.cells['amount'] || d.cells['total'] || '', strong: d.kind === 'grandTotal' })
    }
  }
  const grand = footer.find((f) => f.key === 'grandTotal')
  return { items, adjustments, footer, grandTotal: grand?.value ?? '', hasGst: formatHasGst(format) }
}

/** The first problem that blocks Save (party name first), or null. Same rule as desktop. */
export function checkSave(s: EditorState): SaveIssue | null {
  return validateBillForSave(prepareBillForSave(s.bill))
}

/** What the data layer takes. Unknown fields ride along; `expectedRevision` makes a changed-on-sync bill refuse the save. */
export function toSaveInput(s: EditorState): SaveBillInput {
  const b = s.bill
  return {
    bill: {
      id: b.id, party: b.party, formatId: b.formatId, extraCols: b.extraCols, paperOverride: b.paperOverride, billDate: b.billDate, rows: b.rows,
      roundOff: b.roundOff === 1 ? 1 : 0,
      ...(b.footerExtras ? { footerExtras: b.footerExtras } : {}), ...(b.tailRows ? { tailRows: b.tailRows } : {}), ...(b.hybrid ? { hybrid: b.hybrid } : {})
    },
    ...(s.baseRevision !== null ? { expectedRevision: s.baseRevision } : {})
  }
}

/** Digits with at most one dot (and an optional leading minus). Returns the Dec string to store (`null` = empty / not a number yet) and the text to show. */
export function readNumberText(raw: string, allowNegative: boolean): { text: string; value: string | null } {
  let t = raw.replace(/,/g, '.').replace(allowNegative ? /[^0-9.\-]/g : /[^0-9.]/g, '')
  const neg = allowNegative && t.startsWith('-')
  t = t.replace(/-/g, '')
  const dot = t.indexOf('.')
  if (dot >= 0) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, '')
  const text = (neg ? '-' : '') + t
  const core = t.endsWith('.') ? t.slice(0, -1) : t
  const value = core === '' || core === '.' ? null : (neg ? '-' : '') + (core.startsWith('.') ? `0${core}` : core)
  return { text, value }
}
