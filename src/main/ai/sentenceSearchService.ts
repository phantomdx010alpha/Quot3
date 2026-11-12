import { normaliseItem } from '../../shared/items/normalise'
import { protectedConflict } from '../../shared/ai/partyHistory'
import { textKey } from '../../shared/ai/textKey'
import { cosine } from '../../shared/ai/vectorMath'
import type { SentenceSearchAnswer } from '../../shared/ai/sentenceAnswer'
import type { AiService } from './aiService'
import type { AiVectorRepo } from '../db/aiVectorRepo'

/**
 * Phase 229 (M22) - glue for plain-sentence search. READS only (the items index and the cached vectors) and writes nothing; the
 * filtering and the text search stay on the existing History repos. Two independent answers:
 *  - `formats`: each bill's GST / Non-GST (items index, no model), given whenever `ai.enabled` is on;
 *  - `scores`: a 0..1 similarity of each bill's item names to the typed item words, only when `ai.sentenceSearch` is on AND the model answers.
 * A name whose protected tokens (numbers, sizes, units) conflict with the typed words never scores ("505" vs "D7"). It never throws into callers.
 */
export interface SentenceSearchInput { itemText: string; billIds: string[] }

export interface SentenceSearchDeps {
  items: { billLines(ids: readonly string[]): Record<string, { names: string[]; gst: boolean }> }
  ai: Pick<AiService, 'embed' | 'cancel'>
  vectors: Pick<AiVectorRepo, 'getMany'>
  /** Cache key of the current model (`modelCacheKey`). */
  modelKey: string
  /** `thresholds.sentence` of the current model. */
  threshold: number
  /** `ai.enabled`. */
  isEnabled(): boolean
  /** `ai.enabled` AND `ai.sentenceSearch`. */
  isRerankOn(): boolean
  log?(message: string, extra?: Record<string, unknown>): void
}

export interface SentenceSearchService { searchSentence(input: SentenceSearchInput): Promise<SentenceSearchAnswer> }

export const SENTENCE_GROUP = 'sentence'

/** Map a cosine at or above `threshold` onto 0..1 (the threshold itself is a weak 0, a perfect match 1). */
export function similarityScore(cos: number, threshold: number): number {
  if (!(cos >= threshold)) return 0
  const span = 1 - threshold
  return span <= 0 ? 1 : Math.min(1, Math.max(0.05, (cos - threshold) / span))
}

export function createSentenceSearchService(deps: SentenceSearchDeps): SentenceSearchService {
  let warned = false
  const warnOnce = (m: string): void => { if (!warned) { warned = true; deps.log?.(m) } }
  return {
    async searchSentence(input) {
      const none: SentenceSearchAnswer = { scores: {}, formats: {}, embeddingsUsed: false }
      try {
        if (!deps.isEnabled() || input.billIds.length === 0) return none
        const lines = deps.items.billLines(input.billIds)
        const formats: SentenceSearchAnswer['formats'] = {}
        for (const [id, l] of Object.entries(lines)) formats[id] = l.gst ? 'gst' : 'nongst'
        const base: SentenceSearchAnswer = { scores: {}, formats, embeddingsUsed: false }
        const typed = normaliseItem(input.itemText)
        if (!deps.isRerankOn() || typed.empty || typed.nonProduct) return base
        let q: Float32Array | null = null
        try {
          deps.ai.cancel(SENTENCE_GROUP) // a newer search replaces the one still waiting
          const k = textKey(input.itemText)
          const out = await deps.ai.embed([k ? k.text : input.itemText.trim()], 'query', { group: SENTENCE_GROUP })
          if (out.ok && out.vectors.length === 1) q = out.vectors[0] as Float32Array
        } catch (err) { warnOnce(`sentence: ${err instanceof Error ? err.message : 'embed failed'}`) }
        if (!q) return base
        const hashes = new Set<string>()
        for (const l of Object.values(lines)) for (const n of l.names) { const k = textKey(n); if (k) hashes.add(k.hash) }
        const byHash = new Map(deps.vectors.getMany(deps.modelKey, [...hashes]).map((r) => [r.hash, r.vector]))
        const scores: Record<string, number> = {}
        for (const [id, l] of Object.entries(lines)) {
          let best = 0
          for (const n of l.names) {
            const c = normaliseItem(n)
            if (c.empty || c.nonProduct || protectedConflict(typed.protectedTokens, c.protectedTokens)) continue
            const k = textKey(n)
            const v = k ? byHash.get(k.hash) : undefined
            if (!v) continue
            const s = similarityScore(cosine(q, v), deps.threshold)
            if (s > best) best = s
          }
          if (best > 0) scores[id] = best
        }
        return { scores, formats, embeddingsUsed: true }
      } catch (err) {
        warnOnce(`sentence: ${err instanceof Error ? err.message : 'failed'}`)
        return none
      }
    }
  }
}
