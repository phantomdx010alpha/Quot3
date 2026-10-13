/**
 * Phase 27 — pure rules for saving a bill (no DOM, no Electron, no SQL). Used by the renderer (to jump to the missing
 * field before calling main) AND by the main-process `billService` (authoritative; the renderer is never trusted).
 */
import { classifyRow } from './calc/classifyRow'
import { isEntryBlank } from './gridModel'
import { normalizeBill } from './billModel'
import { PARTY_FIELDS, finalizePartyField } from './partyFields'
import type { Bill, BillRow, PartySnapshot } from './types'

export type SaveIssueCode = 'PARTY_NAME_REQUIRED' | 'NO_ROWS'
export interface SaveIssue {
  code: SaveIssueCode
  message: string
}

export const SAVE_MESSAGES: Readonly<Record<SaveIssueCode, string>> = {
  PARTY_NAME_REQUIRED: 'Enter the party name before saving.',
  NO_ROWS: 'Add at least one item (with a quantity or rate) or an adjustment before saving.'
}

/** Drops trailing blank rows (the grid pads with them for display) and renumbers `idx`. Internal blank rows are kept. */
export function trimTrailingBlankRows(rows: readonly BillRow[]): BillRow[] {
  let end = rows.length
  while (end > 0 && isEntryBlank(rows[end - 1] as BillRow)) end--
  return rows.slice(0, end).map((r, i) => (r.idx === i ? r : { ...r, idx: i }))
}

/** Save-time party snapshot: every field trimmed (address lines too). */
export function finalizeParty(p: PartySnapshot): PartySnapshot {
  const out = { ...p }
  for (const f of PARTY_FIELDS) out[f] = finalizePartyField(f, p[f] ?? '')
  return out
}

/** First problem that blocks a save, or null. Party name comes first so the owner is sent to the top of the page. */
export function validateBillForSave(bill: Pick<Bill, 'party' | 'rows'>): SaveIssue | null {
  if (finalizePartyField('name', bill.party?.name ?? '') === '') return { code: 'PARTY_NAME_REQUIRED', message: SAVE_MESSAGES.PARTY_NAME_REQUIRED }
  const usable = bill.rows.some((r) => {
    const k = classifyRow(r)
    return k === 'item' || k === 'adjustment'
  })
  if (!usable) return { code: 'NO_ROWS', message: SAVE_MESSAGES.NO_ROWS }
  return null
}

/** What actually gets stored: trailing blanks removed, party fields finalised, everything normalised. */
export function prepareBillForSave(bill: Bill): Bill {
  const trimmed: Bill = { ...bill, party: finalizeParty(bill.party), rows: trimTrailingBlankRows(bill.rows) }
  return normalizeBill(trimmed)
}
