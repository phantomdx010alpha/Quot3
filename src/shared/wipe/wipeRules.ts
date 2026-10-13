/**
 * Phase 90 (pure): "Start fresh" rules, shared by the Settings page, the IPC schema, the service and the launch-time apply.
 *   Level 1: clear bills and customers (plus drafts, revisions, import history, the sync queue). Keeps settings, company, license, backups.
 *   Level 2: factory reset (a new empty database: settings, company, branch and license are gone on this computer); the owner
 *            may also remove backups / themes / logs / assets. Safety backups named `pre-wipe-*` are never removed.
 * A wipe never sends deletes to the other branches (the queue is cleared, nothing is captured).
 */
export type WipeLevel = 1 | 2
export const WIPE_WORDS: Record<WipeLevel, string> = { 1: 'START FRESH', 2: 'FACTORY RESET' }
export const WIPE_MARKER = 'wipe-pending.json'
export const PO_START_MAX = 99_999_999

export interface WipeOptions {
  level: WipeLevel
  /** The next bill number after the wipe (>= 1). */
  poStart: number
  /** Level 2 only. */
  removeBackups: boolean
  removeThemes: boolean
  removeLogs: boolean
  removeAssets: boolean
}

export const defaultWipeOptions = (level: WipeLevel = 1): WipeOptions => ({ level, poStart: 1, removeBackups: false, removeThemes: false, removeLogs: false, removeAssets: false })

export const isWipeConfirm = (level: WipeLevel, typed: string): boolean => typed.trim().replace(/\s+/g, ' ').toUpperCase() === WIPE_WORDS[level]

/** Canonical options from untrusted input, or null when unusable. Level 1 ignores the Level 2 folder switches. */
export function normaliseWipeOptions(raw: unknown): WipeOptions | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const level = r['level']
  if (level !== 1 && level !== 2) return null
  const po = r['poStart']
  if (typeof po !== 'number' || !Number.isInteger(po) || po < 1 || po > PO_START_MAX) return null
  const flag = (k: string): boolean => level === 2 && r[k] === true
  return { level, poStart: po, removeBackups: flag('removeBackups'), removeThemes: flag('removeThemes'), removeLogs: flag('removeLogs'), removeAssets: flag('removeAssets') }
}

/** "5" -> 5; blank = 1; anything that is not a whole number from 1 up -> null. */
export function parsePoStart(text: string): number | null {
  const t = text.trim()
  if (t === '') return 1
  if (!/^\d{1,8}$/.test(t)) return null
  const n = Number(t)
  return n >= 1 && n <= PO_START_MAX ? n : null
}

/** A backup file the wipe must keep even when "remove backups" is chosen. */
export const isWipeSafetyFile = (file: string): boolean => file.startsWith('pre-wipe-')
