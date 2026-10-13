import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { Logger } from '../logger'
import { applyMigrations, getUserVersion, loadMigrations } from './migrate'
import * as schema from './schema'
import { ensureLocalBranch } from './seed'

export type Db = BetterSQLite3Database<typeof schema>

export interface DbHandle {
  sqlite: Database.Database
  db: Db
  /** Number of migrations this build ships (== expected user_version). */
  schemaVersion: number
  /** user_version found when the file was opened (before migrating). */
  openedVersion: number
  /** False when the file is from a newer app: opened read-only (`query_only`), never migrated or seeded. */
  writable: boolean
  /** Path of the automatic pre-migration backup, if one was taken this open. */
  preMigrationBackup: string | null
  close(): void
}

export interface OpenDbOptions {
  /** DB file path, or ':memory:'. */
  file: string
  migrationsDir: string
  /** Where the automatic pre-migration backup goes (required for file DBs that already hold data). */
  backupsDir?: string
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
  now?: () => Date
}

const stamp = (d: Date): string => d.toISOString().replace(/[:.]/g, '-')

/**
 * The only place a SQLite file is opened. WAL, foreign_keys=ON, synchronous=NORMAL;
 * newer-than-app DBs are refused for writes; pending migrations on an existing DB are preceded by a
 * consistent backup (`VACUUM INTO`, synchronous) and run transactionally; the local branch is seeded.
 */
export function openDatabase(opts: OpenDbOptions): DbHandle {
  const log = opts.log
  const now = opts.now ?? (() => new Date())
  const sqlite = new Database(opts.file)
  try {
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('synchronous = NORMAL')

    const migrations = loadMigrations(opts.migrationsDir)
    const schemaVersion = migrations.length
    const openedVersion = getUserVersion(sqlite)
    let preMigrationBackup: string | null = null
    let writable = true

    if (openedVersion > schemaVersion) {
      writable = false
      sqlite.pragma('query_only = ON')
      log?.error(`Database user_version ${openedVersion} is newer than this app understands (${schemaVersion}); opened read-only`)
    } else if (openedVersion < schemaVersion) {
      // Existing data (user_version > 0) gets a safety copy first. A brand-new empty DB needs none.
      if (openedVersion > 0 && opts.file !== ':memory:') {
        if (!opts.backupsDir) throw new Error('backupsDir is required to migrate an existing database')
        mkdirSync(opts.backupsDir, { recursive: true })
        let target = join(opts.backupsDir, `pre-migration-v${openedVersion}-to-v${schemaVersion}-${stamp(now())}.db`)
        if (existsSync(target)) target = target.replace(/\.db$/, `-${Date.now()}.db`)
        sqlite.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
        preMigrationBackup = target
        log?.info('Pre-migration backup written', { target })
      }
      const ran = applyMigrations(sqlite, migrations)
      log?.info('Migrations applied', { ran, from: openedVersion, to: schemaVersion })
    }

    const db = drizzle(sqlite, { schema })
    if (writable) ensureLocalBranch(sqlite, now)

    return {
      sqlite,
      db,
      schemaVersion,
      openedVersion,
      writable,
      preMigrationBackup,
      close: () => sqlite.close()
    }
  } catch (err) {
    sqlite.close()
    throw err
  }
}
