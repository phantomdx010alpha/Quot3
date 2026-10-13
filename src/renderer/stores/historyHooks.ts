import type { HistSel } from '@shared/history/undoStack'

/**
 * Phase 16 — hook points for the Phase 17 undo/redo engine. Every multi-cell operation (range clear, cut, paste) runs
 * inside `runAsOneEntry(label, fn)` so the history can later record it as ONE entry (UR §2). Phase 17: `billStore` installs
 * `historyHooks.wrap` (opens one history entry around `fn`); until then (or in tests that replace it) it just runs `fn`.
 */
export interface HistoryHooks {
  wrap: <T>(label: string, fn: () => T) => T
  /** Phase 17: registered by the mounted grid controller (null when no grid is mounted). */
  selection: SelectionPort | null
  /** Phase 17: clock for entry timestamps / coalescing (tests replace it). */
  now: () => number
}
/** Phase 17: how the history reads and restores the grid's active cell / range, and commits an uncommitted draft first. */
export interface SelectionPort {
  get: () => HistSel | null
  restore: (sel: HistSel | null) => void
  /** Commit the active cell's typed-but-uncommitted text to the store (so undo covers it). */
  flush: () => void
}
export const historyHooks: HistoryHooks = { wrap: (_label, fn) => fn(), selection: null, now: () => Date.now() }
export function runAsOneEntry<T>(label: string, fn: () => T): T { return historyHooks.wrap(label, fn) }
