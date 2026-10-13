/** Phase 110 - the shapes the Items service sends over IPC (`items:*`). Pure types; money is decimal strings. */
import type { GroupSpelling, ItemFamily, NotItem, Suggestion } from './grouping'
import type { SalesTab } from './sales'

/** One row of the Groups window: light, so a few thousand fit in one answer. */
export interface GroupSummary {
  id: string
  display: string
  /** Sales across all spellings (Non-GST + GST). */
  count: number
  nonGstCount: number
  gstCount: number
  lastUsed: string | null
  familyId: string | null
  spellingCount: number
  suggestionCount: number
}

export interface ItemsOverview {
  groups: GroupSummary[]
  families: ItemFamily[]
  notItems: NotItem[]
  bills: number
  lines: number
  /** When the grouping behind this answer was computed (ISO). */
  builtAt: string
}

export interface GroupDetail {
  id: string
  display: string
  familyId: string | null
  spellings: GroupSpelling[]
  suggestions: Suggestion[]
}

export interface GroupSales {
  groupId: string
  display: string
  nonGst: SalesTab
  gst: SalesTab
}

export interface RebuildSummary { bills: number; lines: number; spellings: number; groups: number; ms: number }
export interface RebuildProgress { done: number; total: number }

/** Where "open this sale's bill" goes (the History Open action takes the bill id). */
export interface OpenTarget { billId: string; poNumber: string; billDate: string; partyName: string }

/** Phase 113: what the Items page tells the service (group ids and spelling keys; the service turns them into Phase 109 rules). */
export type { DecisionInput } from './decide'
/** Result of one decision. `steps` = how many rule changes it made (a move is two); 0 = it changed nothing (already decided). */
export interface DecisionResult { changed: boolean; steps: number; message: string; /** Group to select next (null = keep). */ selectId: string | null; /** What Undo would revert now (null = nothing). */ undo: string | null }
export interface UndoOutcome { undone: boolean; steps: number; message: string; undo: string | null }
export interface LastDecisionInfo { undo: string | null }
