/**
 * Phase 50 (pure): backup file names, kinds, retention and the typed-confirmation words.
 * No fs, no Electron: the service and the Settings page both use these so they cannot disagree.
 */
export const BACKUP_KINDS = ['auto', 'manual', 'pre-restore', 'pre-migration', 'imported', 'pre-import', 'pre-wipe', 'pre-rollback'] as const
export type BackupKind = (typeof BACKUP_KINDS)[number]

/** Phase 275: automatic daily backups kept (the newest 3; older ones are pruned). */
export const BACKUP_KEEP_AUTO = 3
/** Phase 275: safety copies kept PER `pre-*` kind (the newest 3 of each). */
export const BACKUP_KEEP_PRE = 3
/** The safety-copy kinds that are pruned. `manual` and `imported` are never pruned by code. */
export const PRUNABLE_PRE_KINDS = ['pre-migration', 'pre-restore', 'pre-import', 'pre-wipe', 'pre-rollback'] as const satisfies readonly BackupKind[]
export const RESTORE_WORD = 'RESTORE'
export const RESET_WORD = 'RESET'
/** Backup files larger than this are refused on import (a Quot3 database is a few MB). */
export const BACKUP_IMPORT_MAX_BYTES = 512 * 1024 * 1024

export const isRestoreConfirm = (t: string): boolean => t.trim().toUpperCase() === RESTORE_WORD
export const isResetConfirm = (t: string): boolean => t.trim().toUpperCase() === RESET_WORD

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

/** `<kind>-YYYYMMDD-HHMMSS.db` in LOCAL time (the owner reads these names). */
export function backupFileName(kind: BackupKind, at: Date): string {
  return `${kind}-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}.db`
}

/** The kind a file name stands for (`pre-migration-v1-to-v2-...` from Phase 5 included); null when it is not ours. */
export function backupKindOf(file: string): BackupKind | null {
  if (!/^[A-Za-z0-9._-]+\.db$/.test(file)) return null
  // longest prefix first: `pre-restore` / `pre-migration` before `pre`
  for (const k of [...BACKUP_KINDS].sort((a, b) => b.length - a.length)) if (file.startsWith(`${k}-`)) return k
  return null
}

/** A plain file name inside the backups folder: no path parts, no traversal. */
export function isSafeBackupFile(file: string): boolean {
  return typeof file === 'string' && file.length <= 200 && !file.includes('/') && !file.includes('\\') && !file.includes('..') && backupKindOf(file) !== null
}

export interface PruneCandidate { file: string; kind: BackupKind; createdAt: string }

/**
 * Files to delete: everything after the newest `keep` automatic backups, and, for each `pre-*` kind, everything after the
 * newest `keepPre` of that kind. `manual` and `imported` are never listed, a kind is never emptied (the minimum kept is 1),
 * and a file named in `protect` (the one just created) is never listed.
 */
export function filesToPrune(all: readonly PruneCandidate[], keep: number = BACKUP_KEEP_AUTO, keepPre: number = BACKUP_KEEP_PRE, protect: readonly string[] = []): string[] {
  const num = (n: number, d: number): number => (Number.isFinite(n) ? Math.max(1, Math.floor(n)) : d)
  const kAuto = num(keep, BACKUP_KEEP_AUTO)
  const kPre = num(keepPre, BACKUP_KEEP_PRE)
  const newestFirst = (list: readonly PruneCandidate[]): PruneCandidate[] =>
    [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.file < b.file ? 1 : -1))
  const out: string[] = []
  out.push(...newestFirst(all.filter((f) => f.kind === 'auto')).slice(kAuto).map((f) => f.file))
  for (const kind of PRUNABLE_PRE_KINDS) out.push(...newestFirst(all.filter((f) => f.kind === kind)).slice(kPre).map((f) => f.file))
  return out.filter((f) => !protect.includes(f))
}

/** Local calendar date `YYYY-MM-DD` of an ISO instant. */
export function localDay(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** True when no automatic backup exists for `today` (local `YYYY-MM-DD`): the first launch of the day makes one. */
export function dailyBackupDue(autoCreatedAt: readonly string[], today: string): boolean {
  return !autoCreatedAt.some((t) => localDay(t) === today)
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export const KIND_LABEL: Record<BackupKind, string> = {
  auto: 'Automatic',
  manual: 'Manual',
  'pre-restore': 'Before restore',
  'pre-migration': 'Before update',
  imported: 'Imported',
  'pre-import': 'Before legacy import',
  'pre-wipe': 'Before start fresh',
  'pre-rollback': 'Before going back a version'
}

export interface BackupInfo {
  file: string
  kind: BackupKind
  createdAt: string
  sizeBytes: number
  /** Live + trashed bills in the file; -1 when the file could not be read. */
  billCount: number
  /** False when the file failed to open or `integrity_check` (shown, but Restore refuses it). */
  readable: boolean
}

export interface BackupStatus {
  /** `PRAGMA integrity_check` of the live database, run at startup. */
  integrity: { ok: boolean; message: string }
  /** Newest automatic backup, or null. */
  lastAuto: string | null
  keepAuto: number
  /** The live database is read-only (newer than this app): nothing can be created or restored. */
  readOnly: boolean
}
