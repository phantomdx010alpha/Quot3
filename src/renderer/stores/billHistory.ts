import { createHistory, type History, type HistoryEntry } from '@shared/history/undoStack'
import { applyDocPatches, diffDocs, docsEqualPersisted, docsIdentical, type BillDoc } from '@shared/history/billDoc'
import { historyHooks } from './historyHooks'

/** Flags mirrored into the bill store so the UI (buttons, tooltips, dirty marker) can subscribe. */
export interface HistoryFlags {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
  dirty: boolean
  /** Bumps on every history change (panel re-render trigger). */
  historyVersion: number
}
export const INITIAL_HISTORY_FLAGS: HistoryFlags = { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null, dirty: false, historyVersion: 0 }

export interface DocAccess {
  getDoc(): BillDoc
  /** Replace the undoable state (the store re-pads blank rows and rebuilds the view). */
  applyDoc(doc: BillDoc): void
  setFlags(f: HistoryFlags): void
}

export interface EntryMeta { label: string; key?: string }

/**
 * Phase 17 — glue between the pure history and the bill store. `record` wraps one store mutation: it snapshots the doc
 * before, runs the mutation, and pushes ONE entry (row-level Immer patches) when the doc changed. `wrap` does the same
 * around a group of mutations (range clear / cut / paste = one entry); mutations inside a wrap do not record themselves.
 */
export function createBillHistory(acc: DocAccess, opts: { maxDepth?: number; coalesceMs?: number } = {}) {
  const history: History = createHistory(opts)
  let saved: BillDoc | null = null
  let version = 0
  let batch = false

  function flags(): HistoryFlags {
    const u = history.peekUndo()
    const r = history.peekRedo()
    return {
      canUndo: u !== null,
      canRedo: r !== null,
      undoLabel: u?.label ?? null,
      redoLabel: r?.label ?? null,
      dirty: saved ? !docsEqualPersisted(saved, acc.getDoc()) : false,
      historyVersion: ++version
    }
  }
  const publish = (): void => acc.setFlags(flags())

  function push(before: BillDoc, selBefore: HistoryEntry['selBefore'], meta: EntryMeta): void {
    const after = acc.getDoc()
    if (docsIdentical(before, after)) return
    const { patches, inverse } = diffDocs(before, after)
    if (patches.length === 0) return
    history.push({
      label: meta.label, at: historyHooks.now(), patches, inverse, selBefore,
      selAfter: historyHooks.selection?.get() ?? null, coalesceKey: meta.key
    })
    publish()
  }

  function record<T>(fn: () => T, meta: () => EntryMeta): T {
    if (batch) return fn()
    const before = acc.getDoc()
    const selBefore = historyHooks.selection?.get() ?? null
    const out = fn()
    push(before, selBefore, meta())
    return out
  }

  function wrap<T>(label: string, fn: () => T): T {
    if (batch) return fn()
    const before = acc.getDoc()
    const selBefore = historyHooks.selection?.get() ?? null
    batch = true
    let out: T
    try { out = fn() } finally { batch = false }
    push(before, selBefore, { label })
    return out
  }

  /** Apply entries in order (`inverse` when undoing, `patches` when redoing) as ONE doc replacement. */
  function applyEntries(entries: HistoryEntry[], dir: 'undo' | 'redo'): void {
    let doc = acc.getDoc()
    for (const e of entries) doc = applyDocPatches(doc, dir === 'undo' ? e.inverse : e.patches)
    acc.applyDoc(doc)
  }
  const flush = (): void => { historyHooks.selection?.flush() }

  return {
    record,
    wrap,
    undo(): boolean {
      flush()
      const e = history.undo()
      if (!e) return false
      applyEntries([e], 'undo')
      publish()
      historyHooks.selection?.restore(e.selBefore)
      return true
    },
    redo(): boolean {
      flush()
      const e = history.redo()
      if (!e) return false
      applyEntries([e], 'redo')
      publish()
      historyHooks.selection?.restore(e.selAfter)
      return true
    },
    /** Jump so entries 0..index are applied (-1 = the state when the bill was opened). Returns whether anything moved. */
    jumpTo(index: number): boolean {
      flush()
      const { direction, entries } = history.jumpTo(index)
      if (direction === 'none') return false
      applyEntries(entries, direction)
      publish()
      const last = entries[entries.length - 1] as HistoryEntry
      historyHooks.selection?.restore(direction === 'undo' ? last.selBefore : last.selAfter)
      return true
    },
    list: (): HistoryEntry[] => history.list(),
    cursor: (): number => history.cursor(),
    /** A new bill was opened: empty history, current state = saved state. */
    reset(): void { history.clear(); saved = acc.getDoc(); publish() },
    /**
     * Phase 18 — Revert to last saved (Ctrl+Alt+Z). The revert is ONE history entry, so it is itself undoable (UR §2.5).
     * Returns false when there is nothing to revert (not dirty / no snapshot).
     */
    revertToSaved(label = 'Reverted to last saved'): boolean {
      flush()
      const target = saved
      if (!target || docsEqualPersisted(target, acc.getDoc())) return false
      history.breakCoalesce()
      const before = acc.getDoc()
      const selBefore = historyHooks.selection?.get() ?? null
      acc.applyDoc(target)
      push(before, selBefore, { label })
      publish()
      historyHooks.selection?.restore(selBefore) // drops any draft in the active cell and repaints it from the reverted bill
      return true
    },
    /** Current state is the saved snapshot (Phase 27 calls this after a successful save). History is kept (D-U2). */
    markSaved(): void { history.breakCoalesce(); saved = acc.getDoc(); publish() },
    breakCoalesce: (): void => history.breakCoalesce(),
    /** Re-evaluate dirty after an untracked change. */
    refresh: publish
  }
}
export type BillHistory = ReturnType<typeof createBillHistory>
