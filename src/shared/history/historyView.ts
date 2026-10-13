import type { HistoryEntry } from './undoStack'

/**
 * Phase 18 — pure view-model for the undo/redo UI (UNDO_REDO_RULES §2.6). No DOM, no store.
 * `entries` is `history.list()` (oldest → newest, applied entries first); `cursor` = how many are applied.
 */

/** One line of the history panel. `index` is the `jumpTo` argument (-1 = the state when the bill was opened). */
export interface HistoryRow {
  index: number
  label: string
  /** applied = in the past of the current state; current = the state the bill is in now; undone = a redo entry. */
  state: 'applied' | 'current' | 'undone'
  /** Timestamp of the entry (null for the original-state row). */
  at: number | null
}

export const ORIGINAL_STATE_LABEL = 'Original state (as opened)'

/** Newest first, ending with the original-state row. Exactly one row is `current`. */
export function buildHistoryRows(entries: readonly HistoryEntry[], cursor: number): HistoryRow[] {
  const cur = Math.max(0, Math.min(cursor, entries.length))
  const rows: HistoryRow[] = []
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as HistoryEntry
    rows.push({ index: i, label: e.label, state: i === cur - 1 ? 'current' : i < cur ? 'applied' : 'undone', at: e.at })
  }
  rows.push({ index: -1, label: ORIGINAL_STATE_LABEL, state: cur === 0 ? 'current' : 'applied', at: null })
  return rows
}

/** Tooltip / aria text for the Undo button. */
export function undoTooltip(label: string | null): string { return label ? `Undo: ${label}` : 'Nothing to undo' }
/** Tooltip / aria text for the Redo button. */
export function redoTooltip(label: string | null): string { return label ? `Redo: ${label}` : 'Nothing to redo' }

/** Transient status-bar message after Ctrl+Z / Ctrl+Y / the buttons. */
export function undoNotice(kind: 'undo' | 'redo', ok: boolean, label: string | null): string {
  if (!ok) return `Nothing to ${kind}`
  return `${kind === 'undo' ? 'Undone' : 'Redone'}: ${label ?? ''}`
}

/** Transient message after a jump from the history panel. `row` is the row that was jumped to. */
export function jumpNotice(ok: boolean, row: Pick<HistoryRow, 'index' | 'label'> | null): string {
  if (!ok || !row) return 'Already at that state'
  return row.index < 0 ? 'Jumped to the original state' : `Jumped to: ${row.label}`
}

/** Local wall-clock `HH:MM:SS` for a history row (24 h, zero padded). */
export function formatClock(at: number): string {
  const d = new Date(at)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Revert-to-saved confirmation copy. */
export const REVERT_MESSAGE = 'Discard every change made since the last save and go back to the saved version? You can still undo this with Ctrl+Z.'
export const REVERT_LABEL = 'Reverted to last saved'
