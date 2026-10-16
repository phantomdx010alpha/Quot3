import { z } from 'zod'
import type { LegacyWatchService } from '../services/legacyWatchService'
import type { LegacyWatchApply } from '../services/legacyWatchApply'
import { activityUndoInput, reviewResolveInput } from '../../shared/legacyWatch/reviewTypes'
import { wrapHandler } from './envelope'

const empty = z.object({}).strict()
const pauseInput = z.object({ paused: z.boolean() }).strict()

/** Phase 162: the native folder dialog and the settings write stay in main; the path never reaches the renderer. */
export interface LegacyWatchPickDeps {
  /** Native folder dialog; null = cancelled. */
  pickFolder(): Promise<string | null>
  /** Save the chosen folder as `legacyWatch.folder`. */
  saveFolder(path: string): void
}

/** Phase 163: the Needs review / Activity operations (the apply engine; the renderer never gets the stored file text). */
export type LegacyWatchReviewDeps = Pick<LegacyWatchApply, 'activityItems' | 'reviewLists' | 'reviewCount' | 'resolveReview' | 'undo'>

/** `legacyWatch:*` handlers (Phase 160). IPC calls the service only; the folder path never leaves main (the status carries its last segment). */
export function legacyWatchHandlers(svc: LegacyWatchService, pick?: LegacyWatchPickDeps, review?: LegacyWatchReviewDeps): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    ...(review ? {
      'legacyWatch:reviewList': wrapHandler(empty, () => review.reviewLists()),
      'legacyWatch:reviewCount': wrapHandler(empty, () => ({ count: review.reviewCount() })),
      'legacyWatch:reviewResolve': wrapHandler(reviewResolveInput, (i) => review.resolveReview(i.id, i.action, i.billId)),
      'legacyWatch:activityList': wrapHandler(empty, () => review.activityItems()),
      'legacyWatch:activityUndo': wrapHandler(activityUndoInput, (i) => {
        const r = review.undo(i.id)
        return { message: r.kind === 'imported' ? 'Import undone: the bill is in Recently deleted.' : 'Update undone: the earlier version was saved as a new revision.', billId: r.billId }
      })
    } : {}),
    ...(pick ? {
      // Phase 162: choose the folder to watch. Cancelled -> null (nothing changes); otherwise saved, then the fresh status comes back.
      'legacyWatch:pickFolder': wrapHandler(empty, async () => {
        const path = await pick.pickFolder()
        if (!path) return null
        pick.saveFolder(path)
        return svc.status()
      })
    } : {}),
    'legacyWatch:status': wrapHandler(empty, () => svc.status()),
    'legacyWatch:scanNow': wrapHandler(empty, () => svc.scanNow()),
    'legacyWatch:pause': wrapHandler(pauseInput, (i) => svc.setPaused(i.paused))
  }
}
