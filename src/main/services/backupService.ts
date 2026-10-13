import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import type { AuditInput } from '../../shared/audit'
import { basename, join } from 'node:path'
import { probeDatabase, type SqliteDb } from '../db/probe'
import {
  BACKUP_IMPORT_MAX_BYTES, BACKUP_KEEP_AUTO, backupFileName, backupKindOf, dailyBackupDue, filesToPrune, isResetConfirm,
  isRestoreConfirm, isSafeBackupFile, localDay, type BackupInfo, type BackupKind, type BackupStatus
} from '../../shared/backup/backupRules'
import type { BackupRepo } from '../db/backupRepo'
import { PENDING_DB, stagePending } from '../db/pendingRestore'
import { AppError } from '../ipc/envelope'
import type { Logger } from '../logger'

export interface BackupPorts {
  /** Native Open dialog for a backup file from another machine; null = cancelled. */
  pickFile(): Promise<string | null>
  /** Relaunch the app so the staged restore / reset is applied before the database opens. */
  restart(): void
}

export interface BackupService {
  create(kind?: 'manual' | 'auto' | 'pre-import' | 'pre-wipe'): Promise<BackupInfo>
  list(): BackupInfo[]
  status(): BackupStatus
  /** First launch of the day: one automatic backup if none exists for today, then prune. Returns it, or null. */
  autoIfDue(): Promise<BackupInfo | null>
  /** Stages the restore (after a pre-restore backup) and restarts. */
  restore(input: { file: string; confirm: string }): Promise<{ restarting: true; preRestore: string }>
  delete(file: string): { deleted: true }
  /** Native dialog, checks, then a copy into the backups folder as `imported-...` (restore it from the list afterwards). */
  importFile(): Promise<{ cancelled: boolean; backup?: BackupInfo }>
  /** Stages an empty database (after a pre-restore backup) and restarts. */
  resetLocalData(input: { confirm: string }): Promise<{ restarting: true; preRestore: string }>
}

export interface BackupDeps {
  sqlite: SqliteDb
  repo: BackupRepo
  root: string
  backupsDir: string
  /** Migrations this build ships: a backup from a NEWER app is refused. */
  schemaVersion: number
  ports: BackupPorts
  log: Pick<Logger, 'info' | 'warn' | 'error'>
}
export interface BackupOpts { writable?: boolean; now?: () => Date; keepAuto?: () => unknown; /** Phase 61: audit row for a backup file added from outside. */ audit?: (a: AuditInput) => void }

export { probeDatabase }

export function createBackupService(deps: BackupDeps, opts: BackupOpts = {}): BackupService {
  const writable = opts.writable ?? true
  const now = opts.now ?? (() => new Date())
  const { sqlite, repo, backupsDir, log } = deps
  const keep = (): number => {
    const v = opts.keepAuto?.()
    return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : BACKUP_KEEP_AUTO
  }
  const needWrite = (): void => { if (!writable) throw new AppError('DB_ERROR', 'The database is read-only (it is from a newer version of the app).') }
  const need = (cond: boolean, msg: string): void => { if (!cond) throw new AppError('VALIDATION', msg) }

  // The integrity of the LIVE database, checked once at startup (cheap for a Quot3-sized file).
  const integrity = ((): { ok: boolean; message: string } => {
    try {
      const rows = sqlite.pragma('integrity_check') as { integrity_check: string }[]
      const ok = rows.length === 1 && rows[0]!.integrity_check === 'ok'
      if (!ok) log.error('integrity_check failed', { rows: rows.slice(0, 5) })
      return { ok, message: ok ? 'ok' : rows.slice(0, 3).map((r) => r.integrity_check).join('; ') }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'integrity check failed' }
    }
  })()

  function scan(): BackupInfo[] {
    if (!existsSync(backupsDir)) return []
    const known = new Map(repo.all().map((r) => [r.file, r]))
    const out: BackupInfo[] = []
    for (const file of readdirSync(backupsDir)) {
      const kind = backupKindOf(file)
      if (!kind) continue
      const path = join(backupsDir, file)
      let st
      try { st = statSync(path) } catch { continue }
      if (!st.isFile()) continue
      let row = known.get(file)
      if (!row || row.sizeBytes !== st.size) {
        // A file the table does not know yet (pre-migration copies, files copied in by hand): read it once and remember it.
        const p = probeDatabase(path)
        row = { file, kind, createdAt: st.mtime.toISOString(), sizeBytes: st.size, billCount: p.ok ? p.billCount : -1 }
        if (writable) { try { repo.upsert(row) } catch { /* the list still works */ } }
      }
      out.push({ file, kind, createdAt: row.createdAt, sizeBytes: st.size, billCount: row.billCount, readable: row.billCount >= 0 })
    }
    for (const f of known.keys()) if (!out.some((o) => o.file === f) && writable) { try { repo.remove(f) } catch { /* ignore */ } }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.file < b.file ? 1 : -1))
  }

  async function make(kind: BackupKind): Promise<BackupInfo> {
    mkdirSync(backupsDir, { recursive: true })
    const at = now()
    let file = backupFileName(kind, at)
    for (let n = 2; existsSync(join(backupsDir, file)); n++) file = backupFileName(kind, at).replace(/\.db$/, `-${n}.db`)
    const target = join(backupsDir, file)
    try {
      await sqlite.backup(target) // SQLite online backup API: a consistent copy while the app keeps running
    } catch (err) {
      rmSync(target, { force: true })
      log.error('backup failed', { err })
      throw new AppError('IO_ERROR', 'Could not write the backup file. Check the disk space and try again.')
    }
    const p = probeDatabase(target)
    if (!p.ok) {
      rmSync(target, { force: true })
      log.error('backup did not verify', { message: p.message })
      throw new AppError('IO_ERROR', 'The backup file did not verify and was removed. Try again.')
    }
    const row = { file, kind, createdAt: at.toISOString(), sizeBytes: statSync(target).size, billCount: p.billCount }
    repo.upsert(row)
    log.info('backup created', { file, kind })
    return { ...row, readable: true }
  }

  function prune(): void {
    const doomed = filesToPrune(scan().map((b) => ({ file: b.file, kind: b.kind, createdAt: b.createdAt })), keep())
    for (const f of doomed) {
      rmSync(join(backupsDir, f), { force: true })
      try { repo.remove(f) } catch { /* ignore */ }
    }
    if (doomed.length) log.info('old automatic backups pruned', { count: doomed.length })
  }

  /** Checks a file in the backups folder is one we can restore. */
  function restorable(file: string): string {
    need(isSafeBackupFile(file), 'That is not a backup file name.')
    const path = join(backupsDir, file)
    if (!existsSync(path)) throw new AppError('NOT_FOUND', 'That backup file is no longer there.')
    const p = probeDatabase(path)
    need(p.ok, `That backup cannot be restored: ${p.message}.`)
    need(p.userVersion <= deps.schemaVersion, 'That backup was made by a newer version of the app. Update the app first.')
    return path
  }

  return {
    async create(kind = 'manual') { needWrite(); const b = await make(kind); if (kind === 'auto') prune(); return b },
    list: scan,
    status: () => ({
      integrity,
      lastAuto: scan().find((b) => b.kind === 'auto')?.createdAt ?? null,
      keepAuto: keep(),
      readOnly: !writable
    }),
    async autoIfDue() {
      if (!writable) return null
      const today = localDay(now().toISOString())
      if (!dailyBackupDue(scan().filter((b) => b.kind === 'auto').map((b) => b.createdAt), today)) return null
      const b = await make('auto')
      prune()
      return b
    },
    async restore({ file, confirm }) {
      needWrite()
      need(isRestoreConfirm(confirm), 'Type RESTORE to confirm.')
      const src = restorable(file)
      const pre = await make('pre-restore') // always first: a restore can be undone by restoring this one
      copyFileSync(src, join(deps.root, PENDING_DB))
      stagePending(deps.root, 'restore')
      log.warn('restore staged', { file, preRestore: pre.file })
      deps.ports.restart()
      return { restarting: true as const, preRestore: pre.file }
    },
    delete(file) {
      need(isSafeBackupFile(file), 'That is not a backup file name.')
      const path = join(backupsDir, file)
      if (!existsSync(path)) throw new AppError('NOT_FOUND', 'That backup file is no longer there.')
      rmSync(path, { force: true })
      if (writable) { try { repo.remove(file) } catch { /* ignore */ } }
      return { deleted: true as const }
    },
    async importFile() {
      needWrite()
      const picked = await deps.ports.pickFile()
      if (!picked) return { cancelled: true }
      let st
      try { st = statSync(picked) } catch { throw new AppError('NOT_FOUND', 'That file could not be found.') }
      need(st.isFile(), 'That is not a file.')
      need(st.size > 0 && st.size <= BACKUP_IMPORT_MAX_BYTES, 'That file is empty or too large to be a Quot3 backup.')
      const p = probeDatabase(picked)
      need(p.ok, `That file is not a usable Quot3 backup: ${p.message}.`)
      need(p.userVersion <= deps.schemaVersion, 'That backup was made by a newer version of the app. Update the app first.')
      mkdirSync(backupsDir, { recursive: true })
      const at = now()
      let file = backupFileName('imported', at)
      for (let n = 2; existsSync(join(backupsDir, file)); n++) file = backupFileName('imported', at).replace(/\.db$/, `-${n}.db`)
      copyFileSync(picked, join(backupsDir, file))
      const row = { file, kind: 'imported' as const, createdAt: at.toISOString(), sizeBytes: st.size, billCount: p.billCount }
      repo.upsert(row)
      log.info('backup imported', { file, from: basename(picked) })
      opts.audit?.({ entity: 'backup', entityId: file, action: 'import', detail: { file, bills: p.billCount } })
      return { cancelled: false, backup: { ...row, readable: true } }
    },
    async resetLocalData({ confirm }) {
      needWrite()
      need(isResetConfirm(confirm), 'Type RESET to confirm.')
      const pre = await make('pre-restore')
      stagePending(deps.root, 'reset')
      log.warn('reset staged', { preRestore: pre.file })
      deps.ports.restart()
      return { restarting: true as const, preRestore: pre.file }
    }
  }
}
