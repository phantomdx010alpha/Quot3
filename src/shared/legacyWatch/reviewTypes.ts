/**
 * Phase 163 - Needs review + Activity: the shapes that cross IPC and the plain-words labels (pure; no Electron / Node / DOM).
 * MILESTONE15_DESIGN 3.8. Nothing here carries the legacy file's text; the stored file text stays in main.
 */
import { z } from 'zod'

export const REVIEW_ACTIONS = ['import_new', 'replace', 'ignore', 'reopen'] as const
export type ReviewAction = (typeof REVIEW_ACTIONS)[number]

export interface ReviewCandidate { billId: string; poNumber: string; /** In Recently deleted: cannot be replaced until restored. */ deleted: boolean }

export interface ReviewItem {
  id: string
  fileName: string
  party: string
  billDate: string
  total: string
  /** locally_edited | few_shared_lines | ... (what the classifier said); `reasonText` is the plain-words sentence. */
  why: string
  reason: string
  candidates: ReviewCandidate[]
  createdAt: string
}

export interface ReviewLists { open: ReviewItem[]; ignored: ReviewItem[] }

export interface ActivityItem {
  id: string
  at: string
  kind: string
  fileName: string
  billId: string | null
  party: string
  poNumber: string
  detail: string
  undone: boolean
  /** Only an automatic import or update that has not been undone can be undone from the list. */
  canUndo: boolean
}

export const reviewResolveInput = z.object({
  id: z.string().min(1).max(64),
  action: z.enum(REVIEW_ACTIONS),
  /** Which candidate to replace (needed for `replace` when there is more than one). */
  billId: z.string().min(1).max(64).optional()
}).strict()
export const activityUndoInput = z.object({ id: z.string().min(1).max(64) }).strict()

const WHY: Record<string, string> = {
  locally_edited: 'The matching bill was changed in Quot3 after it was imported, so it was not overwritten.',
  few_shared_lines: 'Same party and date, but the item lines are too different to be sure it is the same bill.',
  several_candidates: 'More than one bill of this party and date could be the match.'
}
/** Plain sentence for a review item; falls back to the stored reason. */
export const whyText = (why: string, reason: string): string => WHY[why] ?? (reason !== '' ? reason : 'Needs your decision.')

const KIND: Record<string, string> = {
  imported: 'Imported', updated: 'Updated', duplicate: 'Skipped duplicate', older: 'Ignored older copy', review: 'Needs review',
  undo: 'Undone', review_ignored: 'Review ignored', review_reopened: 'Review put back'
}
export const activityKindText = (kind: string): string => KIND[kind] ?? kind

/** Open review items (for the badge); never negative. */
export const badgeCount = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)
