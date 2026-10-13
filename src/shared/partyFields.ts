import type { IsoDate, PartySnapshot } from './types'

/** Phase 25 — pure rules for the party/detail bar fields (no DOM, no Electron). */

export type PartyField = keyof PartySnapshot

export const PARTY_FIELDS: readonly PartyField[] = ['name', 'phone', 'transport', 'address']

/** Display label per field (also used in undo labels: "Edited Party name"). */
export const PARTY_FIELD_LABEL: Readonly<Record<PartyField, string>> = {
  name: 'Party name',
  phone: 'Phone',
  transport: 'Transport',
  address: 'Address'
}

export const PARTY_FIELD_MAX: Readonly<Record<PartyField, number>> = { name: 120, phone: 40, transport: 80, address: 400 }

/**
 * Normalise what the owner typed or pasted. Name / phone / transport are single-line (line breaks become one space);
 * the address may span lines (CRLF → LF). Everything is length-capped. Leading spaces are kept while typing (trimming a
 * controlled input would eat the space before the next word); `finalizePartyField` trims for saving.
 */
export function sanitizePartyField(field: PartyField, value: string): string {
  const text = field === 'address' ? value.replace(/\r\n?/g, '\n') : value.replace(/[\r\n\t]+/g, ' ')
  return Array.from(text).slice(0, PARTY_FIELD_MAX[field]).join('')
}

/** Save-time form: trimmed; address lines trimmed and blank edges dropped. */
export function finalizePartyField(field: PartyField, value: string): string {
  const v = sanitizePartyField(field, value)
  return field === 'address' ? v.split('\n').map((l) => l.trim()).join('\n').trim() : v.trim()
}

/** Returns the next snapshot, or the SAME object when nothing changed (callers use identity to skip a history entry). */
export function withPartyField(p: PartySnapshot, field: PartyField, value: string): PartySnapshot {
  const next = sanitizePartyField(field, value)
  return p[field] === next ? p : { ...p, [field]: next }
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A real calendar date `YYYY-MM-DD` (no JS Date parsing — leap years checked by hand). */
export function isValidBillDate(s: string): s is IsoDate {
  const m = DATE_RE.exec(s)
  if (!m) return false
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1) return false
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] as number
  return d <= dim
}

/** True when the caret is at the end edge of a text field with no selection (KB §7: Right there moves to the next field). */
export function atEndEdge(value: string, selStart: number | null, selEnd: number | null): boolean {
  return selStart !== null && selStart === selEnd && selStart >= value.length
}
