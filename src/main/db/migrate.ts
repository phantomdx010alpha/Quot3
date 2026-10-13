import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

/**
 * Minimal migration runner over drizzle-kit's output (`meta/_journal.json` + `NNNN_name.sql`).
 * `PRAGMA user_version` = number of migrations applied, which is also the downgrade guard:
 * a DB whose user_version exceeds what this build ships was written by a newer app.
 */
export interface MigrationFile {
  tag: string
  statements: string[]
}

export function loadMigrations(dir: string): MigrationFile[] {
  const journalPath = join(dir, 'meta', '_journal.json')
  if (!existsSync(journalPath)) throw new Error(`Migration journal not found: ${journalPath}`)
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number; tag: string }[] }
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map((e) => ({
      tag: e.tag,
      statements: readFileSync(join(dir, `${e.tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean)
    }))
}

export function getUserVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number
}

/** Applies every migration after the DB's user_version, each in its own transaction. Returns how many ran. */
export function applyMigrations(db: Database.Database, migrations: MigrationFile[]): number {
  const from = getUserVersion(db)
  let ran = 0
  for (let i = from; i < migrations.length; i++) {
    const m = migrations[i]!
    db.transaction(() => {
      for (const stmt of m.statements) db.exec(stmt)
      db.pragma(`user_version = ${i + 1}`)
    })()
    ran++
  }
  return ran
}
