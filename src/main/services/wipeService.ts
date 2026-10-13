import { isWipeConfirm, normaliseWipeOptions, WIPE_WORDS, type WipeOptions } from '../../shared/wipe/wipeRules'
import type { BackupInfo } from '../../shared/backup/backupRules'
import type { AuditInput } from '../../shared/audit'
import { stagePending } from '../db/pendingRestore'
import { writeWipeOptions } from '../db/wipeApply'
import { AppError } from '../ipc/envelope'
import type { Logger } from '../logger'

export interface WipeService {
  /** Typed confirmation -> `pre-wipe` backup -> staged options -> restart. The wipe itself happens at the next launch. */
  start(input: { options: unknown; confirm: string }): Promise<{ restarting: true; backup: string }>
}

export interface WipeDeps {
  root: string
  backup: { create(kind: 'pre-wipe'): Promise<BackupInfo> }
  restart(): void
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  audit?: (a: AuditInput) => void
}

/**
 * Phase 90 - Start fresh. Order matters: validate, take the safety backup (if that fails nothing is staged), stage, restart.
 * Nothing is deleted here and nothing is queued for sync: the other branches are never told.
 */
export function createWipeService(deps: WipeDeps, opts: { writable?: boolean } = {}): WipeService {
  const writable = opts.writable ?? true
  return {
    async start({ options, confirm }) {
      if (!writable) throw new AppError('DB_ERROR', 'The database is read-only (it is from a newer version of the app).')
      const o: WipeOptions | null = normaliseWipeOptions(options)
      if (!o) throw new AppError('VALIDATION', 'Check the bill number to start from (a whole number from 1).')
      if (!isWipeConfirm(o.level, confirm)) throw new AppError('VALIDATION', `Type ${WIPE_WORDS[o.level]} to confirm.`)
      const b = await deps.backup.create('pre-wipe')
      deps.audit?.({ entity: 'backup', entityId: b.file, action: 'wipe_staged', detail: { level: o.level, poStart: o.poStart, backup: b.file } })
      writeWipeOptions(deps.root, o)
      stagePending(deps.root, 'wipe')
      deps.log.warn('wipe staged', { level: o.level, backup: b.file })
      deps.restart()
      return { restarting: true as const, backup: b.file }
    }
  }
}
