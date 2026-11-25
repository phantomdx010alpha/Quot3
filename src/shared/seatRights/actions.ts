/**
 * Phase 291 (M25-5): the action flags (`shareBills`, `deleteBills`, `editOldBills`, `editCustomers`, `editPayments`). Pure words and the
 * "older than today" rule. Hide in the app only (see `SEAT_RIGHTS_HONEST_LIMIT`); viewing is never blocked.
 */
export const ACTION_OFF_WORDS = {
  shareBills: 'Sharing is switched off for this phone by your admin.',
  deleteBills: 'Deleting bills is switched off for this phone by your admin.',
  editCustomers: 'Adding and editing customers is switched off for this phone by your admin.',
  editPayments: 'Editing payment details is switched off for this phone by your admin.'
} as const

/** The line shown for a bill dated before today when `editOldBills` is off. */
export const OLD_BILLS_VIEW_ONLY = 'Older bills are view only for this phone'

/** `YYYY-MM-DD` of the phone's LOCAL calendar date. */
export function localDateString(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** True when a bill date (`YYYY-MM-DD`) is before the phone's local date. A bill dated today or later is not old. Bad / empty text is not old. */
export function isOlderThanToday(billDate: string | null | undefined, now: Date): boolean {
  return typeof billDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(billDate) && billDate < localDateString(now)
}
