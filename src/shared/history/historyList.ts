import { fmtMoney, tryD } from '../money'

/** Phase 41 — pure helpers behind the History page (lists, formatting, keyboard movement). No DOM, no Electron. */

export interface HistoryDate { date: string; count: number }

export interface BillListItem {
  id: string
  poNumber: string
  poSeq: number
  /** `YYYY-MM-DD`. */
  billDate: string
  partyName: string
  /** Canonical decimal string from the `totals_json` cache ('' when the cache is unreadable). */
  grandTotal: string
  branchId: string
  revision: number
  /** Phase 59: `local_only | pending | synced | conflict` (the bill's sync mark); History shows a small badge for the last three. */
  syncState?: string
  /** Phase 86: the old app's bill reference (`BR1_106`) of an imported bill; absent for bills made here. Kept after an edit. */
  legacyRef?: string
  /** Phase 86: the import batch that made the bill; absent for bills made here. */
  importBatchId?: string
}

/** Phase 86: History source filter. */
export type HistorySource = 'all' | 'created' | 'imported'
export interface SourceFilter { source: HistorySource; batch: string }

export interface HistoryBranch { id: string; name: string; isLocal: boolean }

export const HISTORY_PAGE_SIZE = 200
export const HISTORY_PAGE_MAX = 1000

/** `2026-10-06` -> `06-10-26` (the owner's `DD-MM-YY`). Anything that is not an ISO date is returned unchanged. */
export function formatHistoryDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}-${m[2]}-${m[1]!.slice(2)}` : iso
}

/** Grand total for a list row: `₹1,07,500.00`; an unreadable value shows an em dash instead of a wrong number. */
export function formatHistoryTotal(grandTotal: string): string {
  const d = tryD(grandTotal)
  return d === null ? '—' : fmtMoney(d, { indian: true, symbol: true })
}

/** Keyset cursor for `history:listBills` — opaque to callers, `date|createdAt|id` base64url. */
export interface BillCursor { date: string; createdAt: string; id: string }

export function encodeCursor(c: BillCursor): string {
  return b64urlEncode(`${c.date}|${c.createdAt}|${c.id}`)
}

export function decodeCursor(raw: string): BillCursor | null {
  let text: string
  try { text = b64urlDecode(raw) } catch { return null }
  const parts = text.split('|')
  if (parts.length < 3) return null
  const [date, createdAt, ...rest] = parts
  const id = rest.join('|')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !createdAt || id === '') return null
  return { date, createdAt, id }
}

// base64url without Node's Buffer (this file also runs in the renderer).
function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(raw: string): string {
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

// ---- Phase 146: History order = invoice (PO) number, newest (highest) first ----

/** Splits a PO number like `AV-0748` into prefix `AV-` and the NUMERIC part (a canonical digit string, no leading zeros). The numeric part is the LAST run of digits; a number without digits is malformed (`num` null). */
export function parseInvoiceNumber(po: string): { prefix: string; num: string | null } {
  const m = /^(.*?)(\d+)\D*$/.exec(po.trim())
  if (!m) return { prefix: po.trim(), num: null }
  return { prefix: m[1]!, num: m[2]!.replace(/^0+(?=\d)/, '') }
}

/** Digit strings compared as numbers without float maths (longer = bigger, then lexicographic). */
function cmpDigits(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Phase 146 comparator for `Array.sort`: highest invoice number first (so `10` before `9`, `AV-0749` before `AV-0748`);
 * same number with different prefixes: prefix A-Z, then newer date first; malformed numbers (no digits) go last, by date newest first.
 * Deterministic (final tie-break on id).
 */
export function compareByInvoiceNumber(a: Pick<BillListItem, 'poNumber' | 'billDate' | 'id'>, b: Pick<BillListItem, 'poNumber' | 'billDate' | 'id'>): number {
  const pa = parseInvoiceNumber(a.poNumber)
  const pb = parseInvoiceNumber(b.poNumber)
  const byDateDesc = (): number => (a.billDate < b.billDate ? 1 : a.billDate > b.billDate ? -1 : 0)
  if (pa.num === null || pb.num === null) {
    if (pa.num !== null) return -1
    if (pb.num !== null) return 1
    return byDateDesc() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  }
  const n = cmpDigits(pb.num, pa.num) // descending
  if (n !== 0) return n
  const pre = pa.prefix.toUpperCase()
  const pre2 = pb.prefix.toUpperCase()
  if (pre !== pre2) return pre < pre2 ? -1 : 1
  if (pa.prefix !== pb.prefix) return pa.prefix < pb.prefix ? -1 : 1
  return byDateDesc() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** A new array sorted by `compareByInvoiceNumber` (the input is not changed). */
export function sortBillsByInvoiceNumber<T extends Pick<BillListItem, 'poNumber' | 'billDate' | 'id'>>(items: readonly T[]): T[] {
  return [...items].sort(compareByInvoiceNumber)
}

export type ListKey = 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown'

export function isListKey(key: string): key is ListKey {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'Home' || key === 'End' || key === 'PageUp' || key === 'PageDown'
}

/** New highlighted index for a list key. Clamped (no wrap); an empty list gives -1; no highlight (-1) + Down/Page/End starts at the top/end. */
export function moveListIndex(index: number, count: number, key: ListKey, pageSize = 10): number {
  if (count <= 0) return -1
  const last = count - 1
  const page = Math.max(1, Math.floor(pageSize))
  const clamp = (n: number): number => Math.min(last, Math.max(0, n))
  switch (key) {
    case 'Home': return 0
    case 'End': return last
    case 'ArrowDown': return index < 0 ? 0 : clamp(index + 1)
    case 'ArrowUp': return index < 0 ? 0 : clamp(index - 1)
    case 'PageDown': return index < 0 ? 0 : clamp(index + page)
    case 'PageUp': return index < 0 ? 0 : clamp(index - page)
  }
}

// ---- Phase 42: selection helpers + list export (pure) ----

/** Ids between `anchorId` and `toId` inclusive (either order), in list order. Unknown anchor => just `toId`; unknown `toId` => []. */
export function rangeIds(bills: readonly { id: string }[], anchorId: string | null, toId: string): string[] {
  const to = bills.findIndex((b) => b.id === toId)
  if (to < 0) return []
  const from = anchorId === null ? -1 : bills.findIndex((b) => b.id === anchorId)
  if (from < 0) return [toId]
  const [lo, hi] = from <= to ? [from, to] : [to, from]
  return bills.slice(lo, hi + 1).map((b) => b.id)
}

/** What an action acts on: the multi-selection when there is one, else the highlighted bill. */
export function effectiveTargets(selection: readonly string[], highlighted: string | null): string[] {
  if (selection.length > 0) return [...selection]
  return highlighted === null ? [] : [highlighted]
}

/** Bulk export: the listed bills as TSV for Excel (`Bill No, Date, Party, Total`); the total is the plain canonical decimal, not formatted text. */
export function historyRowsToTsv(items: readonly BillListItem[]): string {
  const cell = (s: string): string => (/[\t\r\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const rows = [['Bill No', 'Date', 'Party', 'Total'], ...items.map((b) => [b.poNumber, formatHistoryDate(b.billDate), b.partyName, b.grandTotal])]
  return rows.map((r) => r.map(cell).join('\t')).join('\r\n')
}

/** "3 bills" / "bill Q3-0012 (Sharma Traders)" for confirm dialogs and status lines. */
export function describeBills(items: readonly Pick<BillListItem, 'poNumber' | 'partyName'>[]): string {
  if (items.length === 1) {
    const b = items[0]!
    return b.partyName ? `bill ${b.poNumber} (${b.partyName})` : `bill ${b.poNumber}`
  }
  return `${items.length} bills`
}
