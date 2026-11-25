import { PRESETS, seatRightsSummary, type SeatFlags, type SeatRightsRow } from './flags'

/** Phase 287 (M25): the words of the desktop "Phone rights" block (pure, so the store and the component test the same text). */
export const PHONE_RIGHTS_APPLY_NOTE = 'A phone applies a change within moments when it is online; an offline phone keeps its last rights until it reaches the server.'
export const PHONE_RIGHTS_ONLY_NOTE = 'These rights are for phones only. This computer is never restricted.'
export const PHONE_RIGHTS_OFFLINE = 'Could not reach the company database. Nothing was saved. Check the internet connection and try again.'
export const PHONE_RIGHTS_NOT_AVAILABLE = 'This company database has no phone rights yet. Ask the owner to run SQL file 23.'
export const PHONE_RIGHTS_SEAT1_ONLY = 'Only the main branch (seat 1) can change the phone rights.'

/** The flags a seat's block starts from: its saved flags, or the Staff preset for a seat the server never configured. */
export const shownFlags = (row: Pick<SeatRightsRow, 'flags' | 'configured'>): SeatFlags => (row.configured ? { ...row.flags } : { ...PRESETS.Staff })

/** "Last saved ..." line. `when` turns an ISO time into text (the component passes the local format). */
export function lastSavedLine(row: Pick<SeatRightsRow, 'configured' | 'updatedAt'>, when: (iso: string) => string = (s) => s): string {
  if (!row.configured) return 'Never saved. The Staff preset applies until you save.'
  if (row.updatedAt === null) return 'Saved earlier (time not known).'
  return `Last saved ${when(row.updatedAt)}.`
}

/** The one-line setting shown above the toggles: "Staff (default)", "Full", "Viewer" or "Custom". */
export const currentSettingLine = (row: Pick<SeatRightsRow, 'flags' | 'configured'>): string => `Now: ${seatRightsSummary(row)}`

/** The plain-words refusal for an IPC error code (the message of the main process is used for everything else). */
export function phoneRightsErrorWords(code: string, message: string): string {
  if (code === 'not_available') return PHONE_RIGHTS_NOT_AVAILABLE
  if (code === 'seat1_only') return PHONE_RIGHTS_SEAT1_ONLY
  if (code === 'SYNC_OFFLINE' || code === 'SERVER_PAUSED') return code === 'SERVER_PAUSED' ? message : PHONE_RIGHTS_OFFLINE
  return message
}

/** Phase 288 (M25): where a phone's rights come from, and the plain words for the sync status / Profile page. */
export type SeatRightsSource = 'seat1' | 'admin' | 'default_staff' | 'unknown_staff' | 'server_unaware' | 'not_linked' | 'cached_offline'
export const SEAT_RIGHTS_SOURCE_WORDS: Readonly<Record<SeatRightsSource, string>> = {
  seat1: 'This phone is the main branch (seat 1) and can do everything.',
  admin: 'Set by your admin.',
  default_staff: 'Your admin has not set rights for this phone yet, so the Staff preset applies.',
  unknown_staff: 'Waiting for your admin\'s answer. The Staff preset applies until it arrives.',
  server_unaware: 'This company database has no phone rights yet, so this phone can do everything except change the Payments list.',
  not_linked: 'Sync is off, so this phone can do everything.',
  cached_offline: 'Could not reach your admin just now. The last known rights stay.'
}
