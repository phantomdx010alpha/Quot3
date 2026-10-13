import { AppError } from '../ipc/envelope'
import type { Logger } from '../logger'
import type { ActivateInputV2, SharedLicenseStatus } from '../../shared/sync/license'
import type { CompareOutcome } from '../../shared/sync/sharedUi'
import type { SharedActivation } from './activationV2'
import type { CompareResult, CompareService } from './compareService'
import type { SharedBranchesService } from './sharedBranches'

/**
 * Phase 140b - what the `syncShared:*` channels call. It ties the activation service, the branch calls and the first compare to the
 * running engine: signing in starts the v2 workers (once the compare has run), signing out stops them first, and the compare is
 * single-flight (the Settings button, the cutover wizard and the automatic resume can never run two at once).
 */
export interface SharedEngine {
  /** Start the v2 workers when sync is on and the compare is done (the manager decides). Idempotent. */
  start(): void
  stop(): void
  /** The first compare ran to the end: start the workers and ask for a push and a pull now. */
  afterCompare(): void
}

export interface SharedSyncService {
  status(opts?: { check?: boolean }): Promise<SharedLicenseStatus>
  activate(input: ActivateInputV2): Promise<SharedLicenseStatus>
  deactivate(input: { confirm: string }): Promise<SharedLicenseStatus>
  nameFree: SharedBranchesService['nameFree']
  rename: SharedBranchesService['rename']
  list: SharedBranchesService['list']
  compare(): Promise<CompareOutcome>
}

export interface SharedSyncDeps {
  activation: SharedActivation
  branches: SharedBranchesService
  compare: CompareService
  engine: SharedEngine
  /** True while the cutover wizard owns the order of the steps (it runs the compare itself, from its own button). */
  cutoverNeeded: () => boolean
  log: Pick<Logger, 'info' | 'warn' | 'error'>
}

/** Wraps a compare service so a second `run()` while one is running gets the same answer instead of starting another. */
export function singleFlightCompare(c: CompareService): CompareService {
  let running: Promise<CompareResult> | null = null
  return {
    needed: () => c.needed(),
    reset: () => c.reset(),
    run() {
      if (running) return running
      const p = c.run().finally(() => { running = null })
      running = p
      return p
    }
  }
}

export function createSharedSyncService(deps: SharedSyncDeps): SharedSyncService {
  const { activation, compare, engine, log } = deps

  async function runCompare(): Promise<CompareOutcome> {
    if (!activation.isActivated()) throw new AppError('VALIDATION', 'Sign in to the shared notebook first.')
    if (!compare.needed()) { engine.afterCompare(); return { state: 'done', upload: 0, download: 0, conflict: 0, skip: 0 } }
    const r = await compare.run()
    if (r.state === 'done') engine.afterCompare()
    return { state: r.state, upload: r.upload, download: r.download, conflict: r.conflict, skip: r.skip }
  }

  return {
    status: (o) => activation.status(o),
    nameFree: (i) => deps.branches.nameFree(i),
    rename: (i) => deps.branches.rename(i),
    list: () => deps.branches.list(),
    compare: runCompare,

    async activate(input) {
      const s = await activation.activate(input)
      engine.start() // waits for the compare (the manager does not start the workers before it ran)
      // Outside the cutover the first compare starts by itself; inside it the wizard's own button runs it (step 3).
      if (!deps.cutoverNeeded()) void runCompare().catch((e) => log.warn('The first compare did not finish', { error: e instanceof Error ? e.message : String(e) }))
      return s
    },

    async deactivate(input) {
      engine.stop()
      return activation.deactivate(input)
    }
  }
}
