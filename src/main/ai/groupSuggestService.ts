import { suggestGroupMerges, type GroupAiInput, type GroupMergeSuggestion } from '../../shared/ai/groupSuggest'
import { textKey } from '../../shared/ai/textKey'
import type { AiVectorRepo } from '../db/aiVectorRepo'

/**
 * Phase 227 (M22) - glue between the pure group-merge engine, the items read model and the vector cache. Suggestions only: it reads
 * (items service, cached vectors) and writes nothing; a merge is only ever made by the owner's Accept (`items:decide`). It embeds
 * nothing itself (the indexer fills the cache), so with the model off, missing or not yet indexed the answer is simply empty
 * (`embeddingsUsed: false`). It never throws into callers.
 */
export interface GroupSuggestOutput { suggestions: GroupMergeSuggestion[]; embeddingsUsed: boolean }

export interface GroupSuggestDeps {
  items: { aiGroups(): { groups: GroupAiInput[]; ruleSuggested: string[]; splitKeyPairs: string[] } }
  vectors: Pick<AiVectorRepo, 'getMany'>
  /** Cache key of the current model (`modelCacheKey`). */
  modelKey: string
  /** `thresholds.group` of the current model. */
  threshold: number
  /** `ai.enabled` AND `ai.itemSuggestions`. */
  isOn(): boolean
  log?(message: string, extra?: Record<string, unknown>): void
}

export interface GroupSuggestService { suggestGroups(input: { groupId: string }): GroupSuggestOutput }

/** How many the main side returns; the renderer drops dismissed ones and shows the first few. */
export const GROUP_SUGGEST_FETCH = 8

export function createGroupSuggestService(deps: GroupSuggestDeps): GroupSuggestService {
  let warned = false
  const none: GroupSuggestOutput = { suggestions: [], embeddingsUsed: false }
  return {
    suggestGroups({ groupId }) {
      try {
        if (!deps.isOn()) return none
        const { groups, ruleSuggested, splitKeyPairs } = deps.items.aiGroups()
        if (!groups.some((g) => g.id === groupId)) return none
        const hashes = new Map<string, string>() // spelling name -> hash
        for (const g of groups) for (const s of g.spellings) { const k = textKey(s.name); if (k) hashes.set(s.name, k.hash) }
        const rows = deps.vectors.getMany(deps.modelKey, [...new Set(hashes.values())])
        if (rows.length === 0) return none
        const byHash = new Map(rows.map((r) => [r.hash, r.vector]))
        const suggestions = suggestGroupMerges({
          groupId, groups, threshold: deps.threshold, max: GROUP_SUGGEST_FETCH,
          vectorOf: (name) => { const h = hashes.get(name); return h ? byHash.get(h) ?? null : null },
          ruleSuggested: new Set(ruleSuggested), splitKeyPairs: new Set(splitKeyPairs)
        })
        return { suggestions, embeddingsUsed: true }
      } catch (err) {
        if (!warned) { warned = true; deps.log?.(`groupSuggest: ${err instanceof Error ? err.message : 'failed'}`) }
        return none
      }
    }
  }
}
