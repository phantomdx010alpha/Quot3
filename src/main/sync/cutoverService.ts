import type { SyncStateRepo } from '../db/syncStateRepo'
import { AppError } from '../ipc/envelope'
import type { Logger } from '../logger'
import {
  CUTOVER_KEYS, CUTOVER_STEP_COUNT, cutoverNeeded, cutoverStep, stepNumber,
  type CutoverCompareNote, type CutoverFacts, type CutoverStatus
} from '../../shared/sync/cutover'
import type { UnifyResult } from '../../shared/customers/duplicates'
import type { CompareResult } from './compareService'
import { SYNC_KEYS } from './licenseService'

/**
 * Phase 140 - the cutover from the v1 postbox to the shared notebook (MILESTONE12_DESIGN section 6, SYNC_SHARED_STORE_SPEC section 2).
 *
 *  1. `begin()`    forced fresh local backup FIRST (the Free plan has no server backups), then the v1 workers are stopped and the v1
 *                  settings are marked inert. If the backup fails nothing else happens: v1 keeps running exactly as before.
 *  2. sign in      done by the normal v2 activation (`SharedSyncSection`): nothing here duplicates it.
 *  3. `compare()`  the first "Compare and sync" (`compareService`, resumable). Same bills on both computers are skipped, bills on one
 *                  side travel to the other, nothing is deleted. Running it again after it finished is a no-op.
 *  4. `unify()`    optional: the exact-same-name customer unify, on ONE computer. Skipping is allowed.
 *     then the v1 license is recorded as abandoned (`cutover.v1Abandoned`); the v1 keys themselves are never deleted (Phase 142 does that).
 *
 * The current step is DERIVED from stored facts (`cutoverStep`), so an interrupted wizard resumes by itself. This service never reads or
 * writes the v1 postbox (it has no v1 transport at all) and never logs a bill or customer name: counts only.
 */
export interface CutoverService {
  status(): CutoverStatus
  begin(): Promise<CutoverStatus>
  compare(): Promise<{ status: CutoverStatus; compare: CutoverCompareNote }>
  unify(input: { skip: boolean }): { status: CutoverStatus; merged: number; billsMoved: number }
}

export interface CutoverDeps {
  sync: Pick<SyncStateRepo, 'get' | 'set' | 'setMany'>
  /** `backupService.create('manual')` (a 'manual' file is never pruned by the automatic backup keeper). */
  backup: { create(kind: 'manual'): Promise<{ file: string }> }
  /** `syncManager.suspend()`: stops the v1 workers. */
  stopV1: () => void
  /** The shared-notebook activation (`activationV2.isActivated`). */
  v2: { isActivated(): boolean }
  compare: { needed(): boolean; run(): Promise<CompareResult> }
  customers: { unify(): UnifyResult }
  /** Called once the compare ran to the end: the app starts / kicks the v2 workers here. */
  afterCompare?: () => void
  audit?: (a: { entity: string; entityId: string | null; action: string; detailJson: string | null }) => void
  log: Pick<Logger, 'info' | 'warn' | 'error'>
}

export function createCutoverService(deps: CutoverDeps, opts: { writable?: boolean; now?: () => Date } = {}): CutoverService {
  const now = opts.now ?? (() => new Date())
  const { sync, log } = deps
  const guard = (): void => { if (opts.writable === false) throw new AppError('DB_ERROR', 'Database is read-only (created by a newer version of Quot3)') }

  const facts = (): CutoverFacts => ({
    v1Active: sync.get(SYNC_KEYS.licenseBlob) !== undefined && sync.get(SYNC_KEYS.orgId) !== undefined,
    backupDone: sync.get(CUTOVER_KEYS.backupFile) !== undefined,
    v2Active: deps.v2.isActivated(),
    compareDone: !deps.compare.needed(),
    unifyDone: sync.get(CUTOVER_KEYS.unify) !== undefined,
    finished: sync.get(CUTOVER_KEYS.doneAt) !== undefined
  })

  function status(): CutoverStatus {
    const f = facts()
    const step = cutoverStep(f)
    return {
      needed: cutoverNeeded(f), step, stepNo: stepNumber(step), stepCount: CUTOVER_STEP_COUNT,
      backupFile: sync.get(CUTOVER_KEYS.backupFile) ?? '',
      v1Inert: sync.get(CUTOVER_KEYS.v1Inert) === '1',
      v1LicenseHint: sync.get(SYNC_KEYS.licenseHint) ?? ''
    }
  }

  function finish(detail: Record<string, unknown>): void {
    const at = now().toISOString()
    sync.setMany({ [CUTOVER_KEYS.doneAt]: at, [CUTOVER_KEYS.v1Abandoned]: at })
    deps.audit?.({ entity: 'sync', entityId: null, action: 'cutover_finished', detailJson: JSON.stringify(detail) })
    log.info('Cutover to the shared notebook finished', detail)
  }

  return {
    status,

    async begin() {
      guard()
      const f = facts()
      if (f.finished) return status()
      if (!f.v1Active && !f.backupDone) throw new AppError('VALIDATION', 'There is no old sync on this computer to move from.')
      if (!f.backupDone) {
        // The backup comes first and must succeed: a failure leaves v1 running and every cutover key unwritten.
        let file: string
        try { file = (await deps.backup.create('manual')).file } catch (e) {
          log.warn('Cutover stopped: the safety backup failed', { error: e instanceof Error ? e.message : String(e) })
          throw e instanceof AppError ? e : new AppError('IO_ERROR', 'The safety backup could not be made, so nothing was changed. Free some disk space and try again.')
        }
        sync.setMany({ [CUTOVER_KEYS.backupFile]: file, [CUTOVER_KEYS.backupAt]: now().toISOString(), [CUTOVER_KEYS.v1Inert]: '1' })
        deps.audit?.({ entity: 'sync', entityId: null, action: 'cutover_started', detailJson: JSON.stringify({ backup: file }) })
      }
      deps.stopV1() // idempotent; also covers a restart between the flag and the stop
      return status()
    },

    async compare() {
      guard()
      const f = facts()
      if (!f.backupDone) throw new AppError('VALIDATION', 'Make the safety backup first.')
      if (!f.v2Active) throw new AppError('VALIDATION', 'Sign in to the shared notebook first.')
      if (f.compareDone) return { status: status(), compare: { state: 'done', upload: 0, download: 0, conflict: 0, skip: 0, already: true } }
      const r = await deps.compare.run()
      if (r.state === 'done') deps.afterCompare?.()
      return { status: status(), compare: { state: r.state, upload: r.upload, download: r.download, conflict: r.conflict, skip: r.skip } }
    },

    unify({ skip }) {
      guard()
      const f = facts()
      if (!f.compareDone) throw new AppError('VALIDATION', 'Run the comparison first.')
      if (f.unifyDone || f.finished) return { status: status(), merged: 0, billsMoved: 0 }
      let merged = 0, billsMoved = 0
      if (!skip) { const r = deps.customers.unify(); merged = r.merged; billsMoved = r.billsMoved }
      sync.set(CUTOVER_KEYS.unify, `${skip ? 'skipped' : 'done'} ${now().toISOString()}`)
      finish({ unify: skip ? 'skipped' : 'done', merged, billsMoved })
      return { status: status(), merged, billsMoved }
    }
  }
}
