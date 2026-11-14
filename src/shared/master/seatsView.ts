/**
 * Phase 265 - plain-words helpers for the Company seats table (API_CONTRACTS.md M24-K). Pure: no Electron / Node / DOM imports.
 */
import { SEAT_LABEL_MAX, type SeatView } from './schemas'

export const capReached = (count: number, max: number): boolean => count >= max
export const capMessage = (max: number): string => `The seat limit of ${max} is reached.`

export const seatStatusWords = (s: Pick<SeatView, 'status'>): string => (s.status === 'active' ? 'Active' : 'Removed')

/** A short local date and time, or `Not yet` when the seat never connected. */
export function lastSeenWords(iso: string | null, locale = 'en-IN'): string {
  if (iso === null || iso === '') return 'Not yet'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'Not yet' : d.toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** A code can be shown for an active seat that has one: existing-login (legacy) seats have none. */
export const canShowCode = (s: Pick<SeatView, 'status' | 'legacy' | 'code'>): boolean => s.status === 'active' && !s.legacy && s.code !== null && s.code !== ''

/** Plain-words problem with a new seat's name, or '' when it is fine. */
export function validateSeatLabel(label: string): string {
  const t = label.trim()
  if (t === '') return 'Type a name for the new seat.'
  if (t.length > SEAT_LABEL_MAX) return `Keep the seat name under ${SEAT_LABEL_MAX + 1} letters.`
  return ''
}

/* ---- Phase 266: seat actions (API_CONTRACTS.md M24-L). Pure rules; the master enforces the same on its side. ---- */

export type SeatActionKind = 'reset' | 'delete' | 'regen' | 'rename'
export const DELETE_WORD = 'DELETE'

export interface SeatActions { reset: boolean; delete: boolean; regen: boolean; rename: boolean; rights: boolean }

/** Which buttons a row gets. Seat 1 has no reset / delete / regenerate / rights button (it is the admin and always has every right). A removed seat has none. */
export function seatActions(s: Pick<SeatView, 'no' | 'status' | 'legacy'>): SeatActions {
  const active = s.status === 'active'
  const other = s.no !== 1
  return { reset: active && other, delete: active && other, regen: active && other && !s.legacy, rename: active, rights: active && other }
}

/** The words above the confirm button; the owner's wording for reset. */
export function confirmWords(kind: SeatActionKind, seat: Pick<SeatView, 'no' | 'label' | 'legacy'>): string {
  if (kind === 'reset') {
    return seat.legacy
      ? `Reset to enable a code: seat ${seat.no} (${seat.label}) uses an existing login and has no code yet. Resetting makes a code for it. Everyone on this seat will reconnect by themselves.`
      : `Everyone on this seat will reconnect by themselves. Seat ${seat.no} (${seat.label}) gets a new password and keeps its code.`
  }
  if (kind === 'delete') return `Delete seat ${seat.no} (${seat.label})? Its devices stop syncing and its code stops working. Type ${DELETE_WORD} to confirm. Bills already on those PCs stay there.`
  if (kind === 'regen') return `Make a new code for seat ${seat.no} (${seat.label})? The old code stops working at once. Devices already linked keep working.`
  return ''
}

/** Delete needs the exact word (spaces around it are ignored); the other actions need only the button. */
export const confirmReady = (kind: SeatActionKind, typed: string): boolean => (kind === 'delete' ? typed.trim() === DELETE_WORD : true)

/** The button text of a reset: the legacy seat is told what it enables. */
export const resetButtonWords = (s: Pick<SeatView, 'legacy'>): string => (s.legacy ? 'Reset to enable a code' : 'Reset')
