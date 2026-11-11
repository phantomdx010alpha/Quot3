/**
 * Phase 218 (M21-3a): bill stepping inside a bill opened from a list (design section 5.1). PURE.
 * `BillContext` is IDs only: no bill content, no amounts. Captured by the UI in Phase 219, used by PageUp / PageDown in Phase 220.
 */
import { stepInList, type StepDir, type StepOptions, type StepResult } from './listStep'

export interface BillContext {
  /** The route the bill was opened from (History, Customers, Items); Esc returns there. */
  sourcePath: string
  /** The FULL ordered, filtered list of bill IDs the owner was looking at, flattened (not only the rendered virtual rows). */
  orderedBillIds: readonly string[]
  /** The bill being viewed now. */
  currentId: string
}

export function makeBillContext(sourcePath: string, orderedBillIds: readonly string[], currentId: string): BillContext {
  return { sourcePath, orderedBillIds: orderedBillIds.filter((id) => id !== ''), currentId }
}

/** The same context with another bill as the current one (after a step). */
export function withCurrentBill(ctx: BillContext, currentId: string): BillContext {
  return ctx.currentId === currentId ? ctx : { ...ctx, currentId }
}

/** Next / previous bill of the list. No wrap, skips missing IDs, nearest when the current ID is gone, safe on empty / one-item lists. */
export function stepBill(orderedIds: readonly string[], currentId: string, dir: StepDir, opts?: StepOptions): StepResult {
  return stepInList(orderedIds, currentId, dir, opts)
}
