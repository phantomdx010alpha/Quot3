import { DRAFT_STALE_DAYS } from './constants'
import { normalizeBill } from './billModel'
import { trimTrailingBlankRows } from './billSave'
import { isEntryBlank } from './gridModel'
import type { Bill, BillRow } from './types'

/**
 * Phase 29 — pure rules for draft autosave / crash recovery (UNDO_REDO_RULES §3). No DOM, no Electron, no DB.
 * A draft is ONE row per open bill session (its id is the session's bill id); its payload is the whole bill as the
 * Create page holds it (minus grid padding), so recovery needs nothing but the draft.
 */
export const DRAFT_PAYLOAD_VERSION = 1

export interface DraftPayload {
  v: typeof DRAFT_PAYLOAD_VERSION
  bill: Bill
}

/** What the Dashboard shows for a recoverable draft. */
export interface DraftSummary {
  id: string
  /** Set when the draft is an edit of a saved bill. */
  billId: string | null
  partyName: string
  /** '' for a bill that was never saved. */
  poNumber: string
  /** Rows with any content (name / qty / rate / total / extras). */
  filledRows: number
  updatedAt: string
}

/** A draft exists only while the bill differs from its saved / opened state; a clean or never-opened bill has none. */
export function shouldKeepDraft(s: { billId: string | null; dirty: boolean }): boolean {
  return s.billId !== null && s.dirty
}

export function buildDraftPayload(bill: Bill): DraftPayload {
  return { v: DRAFT_PAYLOAD_VERSION, bill: { ...bill, rows: trimTrailingBlankRows(bill.rows), deletedAt: null, syncState: 'local_only' } }
}

export type ParsedDraft = { ok: true; bill: Bill } | { ok: false; reason: string }

/** Lenient, non-throwing reader for a stored `payload_json`. The bill is normalised exactly like a loaded saved bill. */
export function parseDraftPayload(json: string): ParsedDraft {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, reason: 'not JSON' }
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'not an object' }
  const o = raw as { v?: unknown; bill?: unknown }
  if (o.v !== DRAFT_PAYLOAD_VERSION) return { ok: false, reason: 'unknown version' }
  const b = o.bill as Partial<Bill> | undefined
  if (!b || typeof b !== 'object' || typeof b.id !== 'string' || b.id === '' || !Array.isArray(b.rows) || typeof b.party !== 'object' || b.party === null) {
    return { ok: false, reason: 'bill missing or malformed' }
  }
  try {
    return { ok: true, bill: normalizeBill(b as Bill) }
  } catch {
    return { ok: false, reason: 'bill could not be read' }
  }
}

/** `null` when the payload is unreadable (such a draft is never offered for recovery; the stale cleanup removes it in time). */
export function summarizeDraft(row: { id: string; billId: string | null; payloadJson: string; updatedAt: string }): DraftSummary | null {
  const p = parseDraftPayload(row.payloadJson)
  if (!p.ok) return null
  return {
    id: row.id,
    billId: row.billId,
    partyName: p.bill.party.name.trim(),
    poNumber: p.bill.poNumber,
    filledRows: p.bill.rows.filter((r: BillRow) => !isEntryBlank(r)).length,
    updatedAt: row.updatedAt
  }
}

const pad2 = (n: number): string => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

/** "today 14:32" / "yesterday 09:10" / "5 Oct 14:32" in the machine's local time. */
export function formatDraftWhen(iso: string, now: Date): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'unknown time'
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (dayKey(d) === dayKey(now)) return `today ${hm}`
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (dayKey(d) === dayKey(y)) return `yesterday ${hm}`
  return `${d.getDate()} ${MONTHS[d.getMonth()] as string} ${hm}`
}

/** "Recover unsaved bill — Ruby Traders, today 14:32" (a saved bill's edit says which PO it was). */
export function draftLabel(s: DraftSummary, now: Date): string {
  const who = s.partyName === '' ? 'no party name yet' : s.partyName
  const po = s.poNumber === '' ? '' : ` (edit of ${s.poNumber})`
  return `Recover unsaved bill — ${who}${po}, ${formatDraftWhen(s.updatedAt, now)}`
}

/** ISO instant before which a draft is stale. */
export function staleCutoff(now: Date, days: number = DRAFT_STALE_DAYS): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}
