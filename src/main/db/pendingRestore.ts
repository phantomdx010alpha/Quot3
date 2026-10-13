import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WIPE_MARKER, isWipeSafetyFile, normaliseWipeOptions } from '../../shared/wipe/wipeRules'

/**
 * Phase 50: Restore / Reset cannot swap the database file while it is open, so they STAGE the change and restart the app;
 * this runs at the very start of the next launch, BEFORE `openDatabase`. It is the only code that replaces `quot3.db`.
 *   restore: `restore-pending.db` (already verified + a pre-restore backup already taken) becomes `quot3.db`
 *   reset:   `quot3.db` is removed; the next open creates a fresh one
 *   wipe:    (Phase 90) options are in `wipe-pending.json`. Level 2 removes `quot3.db` and the chosen folders' contents (never `pre-wipe-*`
 *            backups); Level 1 touches no file here. In both cases the options file STAYS until `applyPendingWipeData` (db/wipeApply.ts)
 *            has run after the database is open (PO restart number, and the Level 1 data clear).
 * The WAL / SHM side files of the old database are always removed (they belong to it, not to the new file).
 */
export type PendingAction = 'restore' | 'reset' | 'wipe'
export const PENDING_MARKER = 'restore-pending.json'
export const PENDING_DB = 'restore-pending.db'

export function stagePending(root: string, action: PendingAction): void {
  writeFileSync(join(root, PENDING_MARKER), JSON.stringify({ action, at: new Date().toISOString() }), 'utf8')
}

export const hasPending = (root: string): boolean => existsSync(join(root, PENDING_MARKER))

export interface PendingResult { applied: PendingAction | null; error: string | null }

export function applyPendingRestore(root: string, dbFile: string = join(root, 'quot3.db')): PendingResult {
  const marker = join(root, PENDING_MARKER)
  if (!existsSync(marker)) return { applied: null, error: null }
  let action: PendingAction | null = null
  try {
    const raw = JSON.parse(readFileSync(marker, 'utf8')) as { action?: unknown }
    action = raw.action === 'restore' || raw.action === 'reset' || raw.action === 'wipe' ? raw.action : null
    if (!action) throw new Error('unreadable marker')
    const staged = join(root, PENDING_DB)
    if (action === 'restore' && !existsSync(staged)) throw new Error('the staged backup file is missing')
    if (action === 'wipe') {
      const opts = normaliseWipeOptions(JSON.parse(readFileSync(join(root, WIPE_MARKER), 'utf8')))
      if (!opts) { rmSync(join(root, WIPE_MARKER), { force: true }); throw new Error('the staged wipe options are unreadable') }
      if (opts.level === 1) return { applied: 'wipe', error: null }
      for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) rmSync(f, { force: true })
      const empty = (dir: string, keep: (name: string) => boolean): void => {
        if (!existsSync(dir)) return
        for (const name of readdirSync(dir)) { if (!keep(name)) { try { rmSync(join(dir, name), { recursive: true, force: true }) } catch { /* a locked file stays; never blocks the wipe */ } } }
      }
      if (opts.removeBackups) empty(join(root, 'backups'), isWipeSafetyFile)
      if (opts.removeThemes) empty(join(root, 'themes'), () => false)
      if (opts.removeLogs) empty(join(root, 'logs'), () => false)
      if (opts.removeAssets) empty(join(root, 'assets'), () => false)
      return { applied: 'wipe', error: null }
    }
    for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) rmSync(f, { force: true })
    if (action === 'restore') renameSync(staged, dbFile)
    return { applied: action, error: null }
  } catch (err) {
    return { applied: null, error: err instanceof Error ? err.message : 'could not apply the staged change' }
  } finally {
    // Whatever happened, never loop: the marker (and any staged copy of a reset) goes.
    rmSync(marker, { force: true })
    if (action !== 'restore') rmSync(join(root, PENDING_DB), { force: true })
  }
}
