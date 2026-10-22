/** Guided flow (Phase 193): the Back order inside the editor and the "Continue draft" request. Plain module state, no React, no data.
 *  `interceptBack` (on the layout definition) is asked by App.tsx BEFORE the unsaved-bill guard: a step back is consumed here (Items -> Party,
 *  Review -> Items, Review after saving -> leave), the first step is not consumed, so the normal guard runs. */
export type GuidedStepId = 'party' | 'items' | 'review'
export const GUIDED_STEPS: readonly GuidedStepId[] = ['party', 'items', 'review']

let backHandler: (() => boolean) | null = null
let continueDraft = false

/** The mounted guided editor registers its step logic here (null on unmount). */
export function setGuidedBackHandler(fn: (() => boolean) | null): void { backHandler = fn }

/** True when the Back was used up by a step change. */
export function guidedInterceptBack(): boolean { return backHandler ? backHandler() : false }

/** Home's "Continue draft": the next editor that opens a NEW bill recovers the saved draft at once instead of offering it (A31 stays: only on this tap). */
export function requestContinueDraft(): void { continueDraft = true }
export function takeContinueDraft(): boolean { const v = continueDraft; continueDraft = false; return v }

/** Pure: where Back goes from a step. `null` = not consumed (the normal guard runs). */
export function stepBack(step: GuidedStepId, saved: boolean): GuidedStepId | 'leave' | null {
  if (saved) return 'leave'
  if (step === 'review') return 'items'
  if (step === 'items') return 'party'
  return null
}
