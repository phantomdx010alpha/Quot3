import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, type DbHandle, type OpenDbOptions } from '../connection'

export const MIGRATIONS_DIR = join(__dirname, '..', 'migrations')

export interface TestDb {
  dir: string
  file: string
  backupsDir: string
  handle: DbHandle
  /** Close and reopen the same file (simulates an app restart). */
  reopen(over?: Partial<OpenDbOptions>): DbHandle
  cleanup(): void
}

/** Temp-file database per test (real file so WAL, reopen and backups behave like production). */
export function openTestDb(over: Partial<OpenDbOptions> = {}): TestDb {
  const dir = mkdtempSync(join(tmpdir(), 'quot3-db-'))
  const file = join(dir, 'quot3.db')
  const backupsDir = join(dir, 'backups')
  const base: OpenDbOptions = { file, migrationsDir: MIGRATIONS_DIR, backupsDir, ...over }
  const t: TestDb = {
    dir,
    file,
    backupsDir,
    handle: openDatabase(base),
    reopen(o = {}) {
      t.handle.close()
      t.handle = openDatabase({ ...base, ...o })
      return t.handle
    },
    cleanup() {
      try {
        t.handle.close()
      } catch {
        /* already closed */
      }
      rmSync(dir, { recursive: true, force: true })
    }
  }
  return t
}
