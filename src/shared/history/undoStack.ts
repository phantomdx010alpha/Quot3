import type { Patch } from 'immer'

/**
 * Phase 17 — the bill-wide undo/redo stacks (pure; spec UNDO_REDO_RULES.md §2). Knows nothing about bills: an entry is
 * `{ patches, inverse }` plus a label, a timestamp and the selection before/after. The store applies the patches.
 *
 * Timeline model: `list()` = every entry oldest → newest, applied ones first then the redo ("future") ones;
 * `cursor()` = how many are applied. `jumpTo(i)` moves the cursor so entries 0..i are applied (i = -1 → initial state).
 */
export const UNDO_MAX_DEPTH = 500
export const UNDO_COALESCE_MS = 1000

/** Selection as stable ids (rows move; indices do not survive row insert/delete). */
export interface HistSel {
  rowId: string
  colKey: string
  range: { anchorRowId: string; anchorCol: string; focusRowId: string; focusCol: string } | null
}

export interface HistoryEntry {
  label: string
  at: number
  patches: Patch[]
  inverse: Patch[]
  selBefore: HistSel | null
  selAfter: HistSel | null
  /** Pushes with the same key within `coalesceMs` of the previous push merge into one entry. */
  coalesceKey?: string
}

export interface JumpResult {
  /** `undo`: apply each entry's `inverse` in order; `redo`: apply each entry's `patches` in order. */
  direction: 'undo' | 'redo' | 'none'
  entries: HistoryEntry[]
}

export interface History {
  push(e: HistoryEntry): void
  undo(): HistoryEntry | null
  redo(): HistoryEntry | null
  canUndo(): boolean
  canRedo(): boolean
  /** Next undo / redo entry without moving (for tooltips). */
  peekUndo(): HistoryEntry | null
  peekRedo(): HistoryEntry | null
  list(): HistoryEntry[]
  cursor(): number
  jumpTo(index: number): JumpResult
  /** The next push starts a new entry even with an equal coalesce key (saves, explicit breaks). */
  breakCoalesce(): void
  clear(): void
}

export function createHistory(opts: { maxDepth?: number; coalesceMs?: number } = {}): History {
  const maxDepth = opts.maxDepth ?? UNDO_MAX_DEPTH
  const coalesceMs = opts.coalesceMs ?? UNDO_COALESCE_MS
  let undoStack: HistoryEntry[] = []
  /** Redo entries; the NEXT redo is the last element. */
  let redoStack: HistoryEntry[] = []
  let coalescible = false

  return {
    push(e) {
      redoStack = []
      const top = undoStack[undoStack.length - 1]
      if (coalescible && top && e.coalesceKey !== undefined && top.coalesceKey === e.coalesceKey && e.at - top.at <= coalesceMs) {
        undoStack[undoStack.length - 1] = {
          ...top,
          patches: top.patches.concat(e.patches),
          inverse: e.inverse.concat(top.inverse),
          selAfter: e.selAfter,
          at: e.at
        }
        return
      }
      undoStack.push(e)
      if (undoStack.length > maxDepth) undoStack.splice(0, undoStack.length - maxDepth)
      coalescible = true
    },
    undo() {
      const e = undoStack.pop()
      if (!e) return null
      redoStack.push(e)
      coalescible = false
      return e
    },
    redo() {
      const e = redoStack.pop()
      if (!e) return null
      undoStack.push(e)
      coalescible = false
      return e
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    peekUndo: () => undoStack[undoStack.length - 1] ?? null,
    peekRedo: () => redoStack[redoStack.length - 1] ?? null,
    list: () => undoStack.concat(redoStack.slice().reverse()),
    cursor: () => undoStack.length,
    jumpTo(index) {
      const total = undoStack.length + redoStack.length
      const target = Math.max(-1, Math.min(total - 1, Math.trunc(index))) + 1 // applied count wanted
      const out: HistoryEntry[] = []
      let direction: JumpResult['direction'] = 'none'
      while (undoStack.length > target) { const e = undoStack.pop() as HistoryEntry; redoStack.push(e); out.push(e); direction = 'undo' }
      while (undoStack.length < target) { const e = redoStack.pop() as HistoryEntry; undoStack.push(e); out.push(e); direction = 'redo' }
      if (out.length) coalescible = false
      return { direction, entries: out }
    },
    breakCoalesce() { coalescible = false },
    clear() { undoStack = []; redoStack = []; coalescible = false }
  }
}
