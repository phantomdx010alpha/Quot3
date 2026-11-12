import { z } from 'zod'
import { EMBED_MAX_CHARS, EMBED_MAX_TEXTS } from '../../shared/ai/aiStatus'
import type { AiService } from '../ai/aiService'
import type { SuggestService } from '../ai/suggestService'
import type { GroupSuggestService } from '../ai/groupSuggestService'
import type { SentenceSearchService } from '../ai/sentenceSearchService'
import { SENTENCE_IDS_MAX } from '../../shared/ai/sentenceAnswer'
import type { AiAdminResult, AiAdminState } from '../../shared/ai/aiAdmin'
import { wrapHandler } from './envelope'

const empty = z.object({}).strict()
const embedInput = z.object({ texts: z.array(z.string().max(EMBED_MAX_CHARS)).min(1).max(EMBED_MAX_TEXTS), kind: z.enum(['query', 'passage']) }).strict()

const groupsInput = z.object({ groupId: z.string().min(1).max(1000) }).strict()

const sentenceInput = z.object({ itemText: z.string().max(200), billIds: z.array(z.string().min(1).max(100)).max(SENTENCE_IDS_MAX) }).strict()

const suggestInput = z.object({ partyId: z.string().min(1).max(100).nullable(), partyName: z.string().max(200), text: z.string().max(200) }).strict()

/** Phase 230: what Settings > AI needs (status + progress + cache size, pause / resume, rebuild, delete). Never touches bills or money. */
export interface AiAdminPort { state(): AiAdminState; pause(): void; resume(): void; rebuild(): void; deleteData(): AiAdminResult }

export interface AiPorts { service: AiService; /** Phase 230: Settings > AI controls (absent = the channels are not registered). */ admin?: AiAdminPort; /** Phase 225: party purchase history (absent = the channel is not registered). */ suggest?: SuggestService; /** Phase 227: suggested group merges for the Items page (absent = the channel is not registered). */ groupSuggest?: GroupSuggestService; /** Phase 229: plain-sentence search re-rank + formats (absent = the channel is not registered). */ sentence?: SentenceSearchService }

/**
 * `ai:*` handlers (Phase 223). `ai:status` is the only channel the renderer bridge exposes. `ai:embed` is registered for main-side
 * callers (later phases) and returns `{ vectors: null, reason }` instead of an error when the AI is off or failing: a failing AI never blocks billing.
 */
export function aiHandlers(p: AiPorts): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'ai:status': wrapHandler(empty, () => p.service.status()),
    'ai:embed': wrapHandler(embedInput, async (i) => {
      const r = await p.service.embed(i.texts, i.kind)
      return r.ok ? { vectors: r.vectors } : { vectors: null, reason: r.reason }
    }),
    // Phase 225: suggestions only; a failing / missing model still answers (tier 1 and 2, `embeddingsUsed: false`).
    // Phase 227: suggestions only; empty when the switch is off or the model has not indexed yet.
    ...(p.groupSuggest ? { 'ai:suggestGroups': wrapHandler(groupsInput, (i) => p.groupSuggest!.suggestGroups(i)) } : {}),
    // Phase 229: reads only; answers empty scores when the switch is off, the model is missing or it fails.
    ...(p.sentence ? { 'ai:searchSentence': wrapHandler(sentenceInput, (i) => p.sentence!.searchSentence(i)) } : {}),
    // Phase 230: Settings > AI. Every handler answers (never throws into the renderer); Delete only drops the vector cache.
    ...(p.admin ? {
      'ai:admin': wrapHandler(empty, () => p.admin!.state()),
      'ai:pause': wrapHandler(empty, () => { p.admin!.pause(); return p.admin!.state() }),
      'ai:resume': wrapHandler(empty, () => { p.admin!.resume(); return p.admin!.state() }),
      'ai:rebuild': wrapHandler(empty, () => { p.admin!.rebuild(); return p.admin!.state() }),
      'ai:deleteData': wrapHandler(empty, () => p.admin!.deleteData())
    } : {}),
    ...(p.suggest ? { 'ai:suggestForParty': wrapHandler(suggestInput, (i) => p.suggest!.suggestForParty(i)) } : {})
  }
}
