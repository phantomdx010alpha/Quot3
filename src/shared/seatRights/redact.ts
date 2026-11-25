import type { SeatFlags } from './flags'

/**
 * Phase 289 (M25-5): hide a customer's address and phone IN THE APP for a phone without `seeAddress` / `seeContact`.
 * Pure. The shared image / PDF builder never calls this: it always receives the UNREDACTED party (owner decision D6).
 * Not a security boundary (see `SEAT_RIGHTS_HONEST_LIMIT`).
 */
export const HIDDEN_BY_ADMIN = 'Hidden by your admin'

/** The two flags this module reads. */
export type PartyRights = Pick<SeatFlags, 'seeAddress' | 'seeContact'>

export interface RedactableParty { phone?: string | null; address?: string | null }

/** A copy of the party with the blanked fields replaced by the marker line. Other fields are untouched; the input is never changed. */
export function redactParty<T extends RedactableParty>(party: T, rights: PartyRights): T {
  const out: T = { ...party }
  if (rights.seeContact !== true && 'phone' in out) (out as RedactableParty).phone = HIDDEN_BY_ADMIN
  if (rights.seeAddress !== true && 'address' in out) (out as RedactableParty).address = HIDDEN_BY_ADMIN
  return out
}

/** One field's text as the screen shows it: the value, or the marker when its flag is off. */
export const partyFieldText = (value: string | null | undefined, visible: boolean, empty = ''): string =>
  !visible ? HIDDEN_BY_ADMIN : value !== null && value !== undefined && value.trim() !== '' ? value : empty

/** Phase 290 (M25-5): the short line that replaces sales totals when `seeSales` is off (the editor, bill view and shared image keep amounts). */
export const SALES_NOT_SHOWN = 'Not shown'
/** The line a screen shows when the phone opens a screen its rights hide (Price List / Payments route). */
export const NOT_AVAILABLE_WORDS = 'Not available'
/** An amount as a LIST or SUMMARY shows it: the text, or the "Not shown" line when `seeSales` is off. */
export const salesText = (text: string, canSeeSales: boolean): string => (canSeeSales ? text : SALES_NOT_SHOWN)
