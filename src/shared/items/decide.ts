/**
 * Phase 113 - turns what the owner did on the Items page (merge / not the same / split / move / not an item) into Phase 109 rule drafts.
 * Pure: no Electron, no Node, no DOM. The page talks in GROUP ids and spelling keys; rules talk in the Phase 107 keys of ORIGINAL spellings
 * (`GroupSpelling.originalKey`). A group is addressed by its most used spelling's key, because the grouping assigns every spelling by its own key
 * (a merge moves the whole group of keyB into the group of keyA; a split pulls only keyB out). Matching stays rule-based and explainable.
 */
import type { ItemGroup } from './grouping'

export type DecisionInput =
  /** Merge group `fromGroupId` into `intoGroupId` (also "confirm this suggestion"). */
  | { op: 'merge'; fromGroupId: string; intoGroupId: string }
  /** "These are different items": silences the suggestion between the two groups for good. */
  | { op: 'reject'; fromGroupId: string; intoGroupId: string }
  /** Pull one spelling (by its original key) out of its group, into a group of its own. */
  | { op: 'split'; groupId: string; spellingKey: string }
  /** Move one spelling to another group (a split from the old group, then a merge into the new one). */
  | { op: 'move'; groupId: string; spellingKey: string; intoGroupId: string }
  /** "Not an item": every spelling of the group leaves the list (the bills are untouched). */
  | { op: 'ignore'; groupId: string }

export interface RuleDraftInput { kind: 'merge' | 'split' | 'ignore'; keyA: string; keyB?: string }

export type DecisionPlan =
  | { ok: true; drafts: RuleDraftInput[]; message: string; /** Group to select afterwards (null = keep the current one). */ selectId: string | null }
  | { ok: false; error: string }

/** Only what the planner reads of a group. */
export type PlanGroup = Pick<ItemGroup, 'id' | 'display'> & { spellings: ReadonlyArray<{ originalKey: string }> }

/** The distinct original keys of a group, most used spelling first. */
export function keysOfGroup(g: PlanGroup): string[] {
  const out: string[] = []
  for (const s of g.spellings) if (!out.includes(s.originalKey)) out.push(s.originalKey)
  return out
}

const fail = (error: string): DecisionPlan => ({ ok: false, error })

export function planDecision(input: DecisionInput, find: (groupId: string) => PlanGroup | undefined): DecisionPlan {
  const need = (id: string): PlanGroup | null => find(id) ?? null
  switch (input.op) {
    case 'merge':
    case 'reject': {
      const from = need(input.fromGroupId)
      const into = need(input.intoGroupId)
      if (!from || !into) return fail('That item no longer exists. Reload the list.')
      if (from.id === into.id) return fail('An item cannot be merged with itself.')
      const a = keysOfGroup(into)[0]
      const b = keysOfGroup(from)[0]
      if (a === undefined || b === undefined) return fail('That item has no spellings.')
      if (input.op === 'merge') return { ok: true, drafts: [{ kind: 'merge', keyA: a, keyB: b }], message: `Merged ${from.display} into ${into.display}.`, selectId: into.id }
      return { ok: true, drafts: [{ kind: 'split', keyA: a, keyB: b }], message: `${from.display} and ${into.display} are kept as different items.`, selectId: null }
    }
    case 'split': {
      const g = need(input.groupId)
      if (!g) return fail('That item no longer exists. Reload the list.')
      const keys = keysOfGroup(g)
      if (!keys.includes(input.spellingKey)) return fail('That spelling is not in this item.')
      const other = keys.find((k) => k !== input.spellingKey)
      if (other === undefined) return fail('All spellings here have the same words, so there is nothing to separate.')
      return { ok: true, drafts: [{ kind: 'split', keyA: other, keyB: input.spellingKey }], message: 'Split into its own item.', selectId: null }
    }
    case 'move': {
      const g = need(input.groupId)
      const into = need(input.intoGroupId)
      if (!g || !into) return fail('That item no longer exists. Reload the list.')
      if (g.id === into.id) return fail('Pick a different item to move it to.')
      const keys = keysOfGroup(g)
      if (!keys.includes(input.spellingKey)) return fail('That spelling is not in this item.')
      const target = keysOfGroup(into)[0]
      if (target === undefined) return fail('That item has no spellings.')
      const other = keys.find((k) => k !== input.spellingKey)
      const drafts: RuleDraftInput[] = []
      // the split MUST come first: rules apply oldest first, and the merge then moves only this one spelling
      if (other !== undefined) drafts.push({ kind: 'split', keyA: other, keyB: input.spellingKey })
      drafts.push({ kind: 'merge', keyA: target, keyB: input.spellingKey })
      return { ok: true, drafts, message: `Moved to ${into.display}.`, selectId: other !== undefined ? null : into.id }
    }
    case 'ignore': {
      const g = need(input.groupId)
      if (!g) return fail('That item no longer exists. Reload the list.')
      const drafts = keysOfGroup(g).map((k): RuleDraftInput => ({ kind: 'ignore', keyA: k }))
      if (drafts.length === 0) return fail('That item has no spellings.')
      return { ok: true, drafts, message: `${g.display} is no longer listed as an item.`, selectId: null }
    }
  }
}
