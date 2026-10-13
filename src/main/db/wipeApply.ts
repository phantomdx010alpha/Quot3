import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { WIPE_MARKER, normaliseWipeOptions, type WipeLevel } from '../../shared/wipe/wipeRules'

/** Writes the options a staged wipe needs at the next launch (the caller then calls `stagePending(root, 'wipe')`). */
export const writeWipeOptions = (root: string, options: unknown): void => writeFileSync(join(root, WIPE_MARKER), JSON.stringify(options), 'utf8')

export interface WipeApplied { level: WipeLevel; poStart: number; cleared: Record<string, number> }

/**
 * Phase 90: runs once at launch, AFTER the database is open, when a wipe was staged. One transaction:
 *   Level 1 clears bills (with rows and revisions), customers, drafts, the import history and the sync queue - NOT settings, the
 *   company, branches, license keys or sync cursors; Level 2 already got a fresh database from `applyPendingRestore`.
 *   Both then set every branch's next PO number to the chosen start.
 * Nothing is captured for sync: the outbox is cleared, never fed, so a wipe never sends deletes. The options file is always removed
 * (a failure rolls the data back and is returned as an error, never retried in a loop).
 */
export function applyPendingWipeData(sqlite: Database.Database, root: string): { applied: WipeApplied | null; error: string | null } {
  const file = join(root, WIPE_MARKER)
  if (!existsSync(file)) return { applied: null, error: null }
  try {
    const opts = normaliseWipeOptions(JSON.parse(readFileSync(file, 'utf8')))
    if (!opts) throw new Error('the staged wipe options are unreadable')
    const cleared: Record<string, number> = {}
    sqlite.transaction(() => {
      if (opts.level === 1) {
        // children first (bill_rows / bill_revisions also cascade); import_batches only describes bills / parties that are going.
        for (const t of ['bill_revisions', 'bill_rows', 'bills', 'parties', 'party_imports', 'import_batches', 'drafts', 'sync_outbox']) {
          cleared[t] = sqlite.prepare(`DELETE FROM ${t}`).run().changes
        }
      }
      sqlite.prepare('UPDATE po_counters SET next_seq = ?').run(opts.poStart)
    })()
    return { applied: { level: opts.level, poStart: opts.poStart, cleared }, error: null }
  } catch (err) {
    return { applied: null, error: err instanceof Error ? err.message : 'could not apply the staged wipe' }
  } finally {
    rmSync(file, { force: true })
  }
}
