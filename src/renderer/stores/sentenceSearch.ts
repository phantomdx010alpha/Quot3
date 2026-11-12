import type { Quot3Bridge } from '@shared/ipc'
import type { BillListItem, HistorySource } from '@shared/history/historyList'
import type { SearchHit } from '@shared/history/historySearch'
import { readAiSettings } from '@shared/ai/aiSettings'
import { parseSentence, type ParsedSentence } from '@shared/ai/sentenceQuery'
import { filterBills, isSentenceSearch, rerankIds, searchPlan, type BillFormat, type SentenceView } from '@shared/ai/sentenceSearch'
import { usePartyIndexStore } from './partyIndexStore'

/**
 * Phase 229 (M22) - plain-sentence search for History and the command palette (renderer glue). It parses the typed text (Phase 228),
 * fetches candidate bills through the EXISTING `history.*` bridge, filters them by the structured parts, and (only when the model
 * answered and `ai.sentenceSearch` is on) re-orders the item matches. Returns `null` when the sentence path does not apply
 * (AI master switch off, or nothing but plain item words), so the caller keeps the old search exactly. It never throws.
 */
type Bridge = Pick<Quot3Bridge, 'history' | 'settings' | 'ai'>
const bridge = (): Partial<Bridge> | undefined => (window as unknown as { quot3?: Partial<Bridge> }).quot3

export const SENTENCE_LIST_MAX = 2000
export interface SentenceArgs { from?: string; to?: string; branch?: string; source?: HistorySource; batch?: string }
export interface SentenceOutcome { items: Array<BillListItem | SearchHit>; truncated: boolean; view: SentenceView }

const localToday = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/** Parse with the saved customers (loaded once); null when the sentence path is off. */
export async function parseTyped(text: string): Promise<{ parsed: ParsedSentence; rerankOn: boolean } | null> {
  try {
    const b = bridge()
    const r = await b?.settings?.getAll()
    if (!r || !r.ok) return null
    const ai = readAiSettings(r.data)
    if (!ai.enabled || text.trim() === '') return null
    const pi = usePartyIndexStore.getState()
    if (!pi.loaded) await pi.load()
    const customers = usePartyIndexStore.getState().parties.map((p) => ({ id: p.id, name: p.name, phone: p.phone }))
    const parsed = parseSentence(text, { today: localToday(), customers })
    return isSentenceSearch(parsed) ? { parsed, rerankOn: ai.sentenceSearch } : null
  } catch { return null }
}

/** Every bill of the dates in range, newest date first (the lists path: no item words and no party to search for). */
async function walkLists(h: Bridge['history'], args: SentenceArgs): Promise<{ items: BillListItem[]; truncated: boolean } | null> {
  const d = await h.listDates(args)
  if (!d.ok) return null
  const out: BillListItem[] = []
  for (const day of d.data) {
    let cursor: string | undefined
    for (;;) {
      const r = await h.listBills({ date: day.date, ...args, ...(cursor ? { cursor } : {}) })
      if (!r.ok) return null
      out.push(...r.data.items)
      if (out.length >= SENTENCE_LIST_MAX) return { items: out.slice(0, SENTENCE_LIST_MAX), truncated: true }
      if (!r.data.next) break
      cursor = r.data.next
    }
  }
  return { items: out, truncated: false }
}

export async function runSentenceSearch(text: string, args: SentenceArgs): Promise<SentenceOutcome | null> {
  const typed = await parseTyped(text)
  if (!typed) return null
  const b = bridge()
  const h = b?.history
  if (!h) return null
  try {
    const { query, chips } = typed.parsed
    const plan = searchPlan(query, { ...(args.from ? { from: args.from } : {}), ...(args.to ? { to: args.to } : {}) })
    const scope = { ...(args.branch ? { branch: args.branch } : {}), ...(args.source ? { source: args.source } : {}), ...(args.batch ? { batch: args.batch } : {}) }
    const range = { ...(plan.from ? { from: plan.from } : {}), ...(plan.to ? { to: plan.to } : {}) }
    let fetched: { items: BillListItem[]; truncated: boolean } | null
    if (plan.mode === 'lists') fetched = await walkLists(h, { ...scope, ...range })
    else {
      const r = await h.search({ query: plan.text, ...scope, ...range })
      fetched = r.ok ? { items: r.data.items, truncated: r.data.truncated } : null
    }
    if (!fetched) return null
    // The format of a bill comes from the items index (main); without it the format chip cannot filter and says so.
    let formats: Record<string, BillFormat> = {}
    let scores: Record<string, number> = {}
    let reranked = false
    const wantsFormat = query.format !== undefined
    const rerankable = plan.mode === 'text' && typed.rerankOn
    if (fetched.items.length > 0 && (wantsFormat || rerankable) && b?.ai) {
      try {
        const a = await b.ai.searchSentence({ itemText: query.itemText, billIds: fetched.items.slice(0, 1000).map((x) => x.id) })
        if (a.ok) { formats = a.data.formats; if (rerankable && a.data.embeddingsUsed) { scores = a.data.scores; reranked = true } }
      } catch { /* the chips and the filters still work; only the format filter and the re-rank are lost */ }
    }
    let items = filterBills(fetched.items, query, wantsFormat ? (id) => formats[id] : undefined)
    const formatUnknown = wantsFormat ? items.filter((x) => formats[x.id] === undefined).length : 0
    if (reranked) {
      const order = rerankIds(items.map((x) => x.id), scores)
      const byId = new Map(items.map((x) => [x.id, x]))
      items = order.map((id) => byId.get(id)!).filter(Boolean)
    }
    return { items, truncated: fetched.truncated, view: { chips, text, reranked, formatUnknown } }
  } catch { return null }
}
