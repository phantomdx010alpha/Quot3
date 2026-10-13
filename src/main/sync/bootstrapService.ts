import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BootstrapRepo } from '../db/bootstrapRepo'
import type { BranchRepo } from '../db/branchRepo'
import { probeDatabase } from '../db/probe'
import { AppError } from '../ipc/envelope'
import type { Logger } from '../logger'
import { isSafeBackupFile } from '../../shared/backup/backupRules'
import { chooseBootstrapPrefix, suggestFreePrefix, type BootstrapPreview, type BootstrapResult } from '../../shared/sync/bootstrap'

export interface BootstrapService {
  /** What importing this backup would do (a dry run of the real merge; nothing is written). */
  preview(file: string): BootstrapPreview
  /** Safety backup, optional new prefix, then the merge, all or nothing. Imported bills are never queued for sending. */
  apply(input: { file: string; prefix?: string | undefined }): Promise<BootstrapResult>
}

export interface BootstrapDeps {
  repo: BootstrapRepo
  branches: BranchRepo
  backupsDir: string
  /** Migrations this build ships: a file from a NEWER app is refused. */
  schemaVersion: number
  /** A copy of this computer's data, made right before the import. Returns the file name. */
  safetyBackup: () => Promise<string>
  isActivated: () => boolean
  log: Pick<Logger, 'info' | 'warn' | 'error'>
}

/** Phase 58: the new-branch bootstrap (see `shared/sync/bootstrap.ts`). The backup file comes from Phase 50's Import. */
export function createBootstrapService(deps: BootstrapDeps, opts: { writable?: boolean; now?: () => Date } = {}): BootstrapService {
  const writable = opts.writable ?? true
  const now = opts.now ?? (() => new Date())
  const need = (cond: boolean, msg: string): void => { if (!cond) throw new AppError('VALIDATION', msg) }

  function fileOf(file: string): string {
    need(isSafeBackupFile(file), 'That is not a backup file name.')
    const path = join(deps.backupsDir, file)
    if (!existsSync(path)) throw new AppError('NOT_FOUND', 'That backup file is no longer there.')
    const p = probeDatabase(path)
    need(p.ok, `That file is not a usable Quot3 backup: ${p.message}.`)
    need(p.userVersion <= deps.schemaVersion, 'That backup was made by a newer version of the app. Update the app first.')
    return path
  }

  function local(): { id: string; name: string; poPrefix: string } {
    const b = deps.branches.local()
    if (!b) throw new AppError('NOT_FOUND', 'No local branch.')
    return { id: b.id, name: b.name, poPrefix: b.poPrefix }
  }

  function dryRun(path: string, file: string): BootstrapPreview {
    const me = local()
    const inFile = deps.repo.fileBranches(path)
    const importedPrefixes = inFile.filter((b) => b.id !== me.id).map((b) => b.poPrefix)
    const clash = importedPrefixes.some((p) => p.toUpperCase() === me.poPrefix.toUpperCase())
    const suggested = suggestFreePrefix(me.poPrefix, [...importedPrefixes, ...deps.branches.otherPrefixes(me.id)])
    let r
    try {
      r = deps.repo.merge(path, { dryRun: true, ...(clash ? { setPrefix: { branchId: me.id, to: suggested } } : {}) })
    } catch (err) {
      deps.log.warn('bootstrap dry run failed', { err })
      throw new AppError('VALIDATION', 'That backup cannot be merged into this computer\'s data. It may use a PO prefix that another branch here already has.')
    }
    const { branches, ...counts } = r
    return {
      file, ...counts, branches: branches.filter((b) => b.id !== me.id), local: me, prefixClash: clash, suggestedPrefix: suggested, activated: deps.isActivated()
    }
  }

  return {
    preview(file) { return dryRun(fileOf(file), file) },
    async apply({ file, prefix }) {
      if (!writable) throw new AppError('DB_ERROR', 'The database is read-only (it is from a newer version of the app).')
      const path = fileOf(file)
      const me = local()
      const inFile = deps.repo.fileBranches(path)
      const choice = chooseBootstrapPrefix(me.poPrefix, prefix, inFile.filter((b) => b.id !== me.id).map((b) => b.poPrefix), deps.branches.otherPrefixes(me.id))
      if (!choice.ok) throw new AppError('VALIDATION', choice.message)
      const changed = choice.prefix.toUpperCase() !== me.poPrefix.toUpperCase()
      const safety = await deps.safetyBackup() // always first; a failure here stops the import
      let r
      try {
        r = deps.repo.merge(path, changed ? { setPrefix: { branchId: me.id, to: choice.prefix } } : {})
      } catch (err) {
        deps.log.error('bootstrap import failed (rolled back)', { err })
        throw new AppError('DB_ERROR', 'The import could not be completed and nothing was changed. Your data is also saved in the safety backup.')
      }
      const { branches, ...counts } = r
      deps.branches.audit({
        at: now().toISOString(), branchId: me.id, entity: 'branch', entityId: me.id, action: 'bootstrap_import',
        detailJson: JSON.stringify({ file, ...counts, branches: branches.map((b) => ({ id: b.id, poPrefix: b.poPrefix, newBills: b.newBills })), prefix: changed ? { from: me.poPrefix, to: choice.prefix } : null })
      })
      deps.log.info('bootstrap import done', { file, billsAdded: counts.billsAdded })
      return { ...counts, prefix: choice.prefix, prefixChanged: changed, activated: deps.isActivated(), safetyBackup: safety }
    }
  }
}
