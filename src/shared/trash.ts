import { TRASH_RETENTION_DAYS } from './constants'

/** Phase 43 (pure): everything the Recently deleted view and the purge need to agree on. */

export interface TrashItem {
  id: string
  poNumber: string
  poSeq: number
  billDate: string
  partyName: string
  /** Canonical decimal string from the cached totals, '' when the cache is unreadable. */
  grandTotal: string
  branchId: string
  revision: number
  /** When it was moved to the trash (ISO). */
  deletedAt: string
  /** When the launch sweep will purge it (ISO) - `deletedAt` + retention. */
  purgeAt: string
}

/** The word the owner types to confirm "Empty trash". */
export const EMPTY_TRASH_WORD = 'EMPTY'
export const isEmptyTrashConfirm = (text: string): boolean => text.trim().toUpperCase() === EMPTY_TRASH_WORD

const DAY_MS = 86_400_000

/** The retention setting made safe: a whole number of days in 1..3650, else the default. */
export function sanitizeRetentionDays(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return TRASH_RETENTION_DAYS
  return Math.min(3650, Math.max(1, Math.floor(n)))
}

/** `deletedAt` + `days`, as ISO. An unparseable date returns it unchanged (never throws). */
export function purgeAt(deletedAt: string, days: number = TRASH_RETENTION_DAYS): string {
  const t = Date.parse(deletedAt)
  return Number.isNaN(t) ? deletedAt : new Date(t + days * DAY_MS).toISOString()
}

/** Bills deleted before this instant are due for purging. */
export const trashCutoff = (now: Date, days: number = TRASH_RETENTION_DAYS): string => new Date(now.getTime() - days * DAY_MS).toISOString()

/** Whole days left before the purge, rounded UP (so "1" still means some time remains), never below 0. */
export function daysLeft(purgeAtIso: string, now: Date): number {
  const t = Date.parse(purgeAtIso)
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.ceil((t - now.getTime()) / DAY_MS))
}

export const describeTrashItem = (t: Pick<TrashItem, 'poNumber' | 'partyName'>): string => (t.partyName ? `${t.poNumber} (${t.partyName})` : t.poNumber)

export function describeTrashItems(items: readonly Pick<TrashItem, 'poNumber' | 'partyName'>[]): string {
  if (items.length === 1) return describeTrashItem(items[0]!)
  return `${items.length} bills`
}

const p2 = (n: number): string => String(n).padStart(2, '0')

/** `08-10-26 14:05` in the machine's local time; an unparseable value is returned unchanged. */
export function formatDeletedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${p2(d.getDate())}-${p2(d.getMonth() + 1)}-${p2(d.getFullYear() % 100)} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

/** "Purges in" column: `today`, `1 day`, `12 days`. */
export function formatPurgeIn(purgeAtIso: string, now: Date): string {
  const n = daysLeft(purgeAtIso, now)
  return n <= 0 ? 'today' : n === 1 ? '1 day' : `${n} days`
}
