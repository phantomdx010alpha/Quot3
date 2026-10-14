/**
 * Phase 27 — pure rules for saving a bill (no DOM, no Electron, no SQL). Used by the renderer (to jump to the missing
 * field before calling main) AND by the main-process `billService` (authoritative; the renderer is never trusted).
 */
import { classifyRow } from './calc/classifyRow'
import { isEntryBlank } from './gridModel'
import { normalizeBill } from './billModel'
import { PARTY_FIELDS, finalizePartyField } from './partyFields'
import { formatHasMoney } from './calc/rowCalc'
import { resolveFormat } from './format/registry'
import type { Bill, BillRow, PartySnapshot } from './types'

export type SaveIssueCode = 'PARTY_NAME_REQUIRED' | 'NO_ROWS'
export interface SaveIssue {
  code: SaveIssueCode
  message: string
}

export const SAVE_MESSAGES: Readonly<Record<SaveIssueCode | 'BRANCH_REQUIRED', string>> = {
  PARTY_NAME_REQUIRED: 'Enter the party name before saving.',
  NO_ROWS: 'Add at least one item (with a quantity or rate) or an adjustment before saving.',
  /** Phase 149: shown instead of PARTY_NAME_REQUIRED for a Stock transfer. */
  BRANCH_REQUIRED: 'Select the branch for this transfer before saving.'
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
export function validateBillForSave(bill: Pick<Bill, 'party' | 'rows'> & { formatId?: string }): SaveIssue | null {
  const format = resolveFormat(bill.formatId)
  // Phase 149: a Stock transfer needs its branch (stored in the party name; same code so the editor jumps to the field) and counts only item rows.
  if (finalizePartyField('name', bill.party?.name ?? '') === '') {
    return { code: 'PARTY_NAME_REQUIRED', message: format.partyMode === 'branch' ? SAVE_MESSAGES.BRANCH_REQUIRED : SAVE_MESSAGES.PARTY_NAME_REQUIRED }
  }
  const money = formatHasMoney(format)
  const usable = bill.rows.some((r) => {
    const k = classifyRow(r)
    return k === 'item' || (money && k === 'adjustment')
  })
  if (!usable) return { code: 'NO_ROWS', message: SAVE_MESSAGES.NO_ROWS }
  return null
}

/** What actually gets stored: trailing blanks removed, party fields finalised, everything normalised. */
export function prepareBillForSave(bill: Bill): Bill {
  const trimmed: Bill = { ...bill, party: finalizeParty(bill.party), rows: trimTrailingBlankRows(bill.rows) }
  // Phase 151: the Hybrid second table is padded with blank rows for display too; they are not stored (twin pairings of dropped rows are pruned by normalizeBill).
  if (bill.hybrid) trimmed.hybrid = { ...bill.hybrid, rows: trimTrailingBlankRows(bill.hybrid.rows) }
  return normalizeBill(trimmed)
}
