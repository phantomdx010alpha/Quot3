/**
 * Phase 218 (M21-3): PageUp / PageDown party paging on the list screens (design section 5). PURE.
 * `list` is the party IDs in the order the owner is looking at (current sort and filter), not row numbers.
 */
import { stepInList, type StepDir, type StepOptions, type StepResult } from './listStep'

export type { StepDir, StepResult }

/** Next / previous party. No wrap (`atEnd` at the first / last), nearest when the current party is missing from the list. */
export function nextParty(list: readonly string[], currentId: string | null, dir: StepDir, opts?: StepOptions): StepResult {
  return stepInList(list, currentId, dir, opts)
}
