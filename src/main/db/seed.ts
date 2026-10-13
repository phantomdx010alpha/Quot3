import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { DEFAULT_PO_PREFIX } from '../../shared/po'

export interface LocalBranch {
  id: string
  name: string
  poPrefix: string
}

/** Idempotent: guarantees exactly one `is_local=1` branch (default prefix `Q3-`) and its PO counter row. */
export function ensureLocalBranch(sqlite: Database.Database, now: () => Date = () => new Date()): LocalBranch {
  const read = (): LocalBranch | undefined =>
    sqlite.prepare('SELECT id, name, po_prefix AS poPrefix FROM branches WHERE is_local = 1').get() as LocalBranch | undefined
  const existing = read()
  if (existing) {
    sqlite.prepare('INSERT OR IGNORE INTO po_counters (branch_id, next_seq) VALUES (?, 1)').run(existing.id)
    return existing
  }
  return sqlite.transaction((): LocalBranch => {
    const branch: LocalBranch = { id: randomUUID(), name: 'Main', poPrefix: DEFAULT_PO_PREFIX }
    sqlite
      .prepare('INSERT INTO branches (id, name, po_prefix, is_local, created_at) VALUES (?, ?, ?, 1, ?)')
      .run(branch.id, branch.name, branch.poPrefix, now().toISOString())
    sqlite.prepare('INSERT INTO po_counters (branch_id, next_seq) VALUES (?, 1)').run(branch.id)
    return branch
  })()
}

export function getLocalBranch(sqlite: Database.Database): LocalBranch {
  const b = sqlite.prepare('SELECT id, name, po_prefix AS poPrefix FROM branches WHERE is_local = 1').get() as LocalBranch | undefined
  if (!b) throw new Error('No local branch row (database not seeded)')
  return b
}
