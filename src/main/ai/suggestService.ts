import { suggestFromHistory, type HistoryLine, type PartySuggestion } from '../../shared/ai/partyHistory'
import { textKey } from '../../shared/ai/textKey'
import { partyKeyOf, type SaleLine } from '../../shared/items/sales'
import type { AiService } from './aiService'
import type { AiVectorRepo } from '../db/aiVectorRepo'

/**
 * Phase 225 (M22) - glue between the pure party-history engine, the items read model and the model. Suggestions only; it reads
 * bills (through the items service) and the vector cache and writes nothing. A missing / off / failing model gives tier 1 and 2
 * only, flagged `embeddingsUsed: false`. It never throws into callers.
 */
export interface SuggestInput { partyId: string | null; partyName: string; text: string }
export interface SuggestOutput { suggestions: PartySuggestion[]; embeddingsUsed: boolean }

export interface SuggestDeps {
  items: { partyHistory(partyKey: string): { lines: SaleLine[]; groupIdOf(name: string): string | null } }
  ai: Pick<AiService, 'embed' | 'cancel'>
  vectors: Pick<AiVectorRepo, 'getMany'>
  /** Cache key of the current model (`modelCacheKey`). */
  modelKey: string
  /** `thresholds.history` of the current model. */
  threshold: number
  /** `ai.enabled`. */
  isEnabled(): boolean
  log?(message: string, extra?: Record<string, unknown>): void
}

export interface SuggestService { suggestForParty(input: SuggestInput): Promise<SuggestOutput> }

export const SUGGEST_GROUP = 'suggest'

/** A sale line as the engine sees it. GST = the bill's format has GST columns; otherwise Non-GST (other formats keep that label [A]). */
export function toHistoryLine(l: SaleLine): HistoryLine {
  return { billId: l.billId, name: l.name, qty: l.qty, unit: null, rate: l.rate, billDate: l.billDate, createdAt: l.createdAt, gst: l.gst, formatLabel: l.gst ? 'GST' : 'Non-GST' }
}

export function createSuggestService(deps: SuggestDeps): SuggestService {
  let warned = false
  const warnOnce = (m: string): void => { if (!warned) { warned = true; deps.log?.(m) } }
  return {
    async suggestForParty(input) {
      try {
        const empty = input.partyId === null && input.partyName.trim() === ''
        if (empty || input.text.trim() === '') return { suggestions: [], embeddingsUsed: false }
        const { lines: sale, groupIdOf } = deps.items.partyHistory(partyKeyOf(input.partyId, input.partyName))
        const lines = sale.map(toHistoryLine)
        const base = { typed: input.text, lines, groupIdOf, threshold: deps.threshold }
        if (lines.length === 0 || !deps.isEnabled()) return suggestFromHistory(base)
        let typedVector: Float32Array | null = null
        try {
          deps.ai.cancel(SUGGEST_GROUP) // a newer keystroke replaces the one still waiting
          const k = textKey(input.text)
          const out = await deps.ai.embed([k ? k.text : input.text.trim()], 'query', { group: SUGGEST_GROUP })
          if (out.ok && out.vectors.length === 1) typedVector = out.vectors[0] as Float32Array
        } catch (err) { warnOnce(`suggest: ${err instanceof Error ? err.message : 'embed failed'}`) }
        if (!typedVector) return suggestFromHistory(base)
        const byHash = new Map<string, string[]>()
        for (const l of lines) {
          const k = textKey(l.name)
          if (!k) continue
          const list = byHash.get(k.hash)
          if (list) list.push(l.name); else byHash.set(k.hash, [l.name])
        }
        const vecByHash = new Map(deps.vectors.getMany(deps.modelKey, [...byHash.keys()]).map((r) => [r.hash, r.vector]))
        return suggestFromHistory({
          ...base, typedVector,
          vectorOf: (name) => { const k = textKey(name); return k ? vecByHash.get(k.hash) ?? null : null }
        })
      } catch (err) {
        warnOnce(`suggest: ${err instanceof Error ? err.message : 'failed'}`)
        return { suggestions: [], embeddingsUsed: false }
      }
    }
  }
}
