import { tryD } from '../money'
import { normalizePartyName } from '../party/partyLite'
import type { BillListItem } from '../history/historyList'
import type { ParsedSentence, QueryChip, StructuredQuery } from './sentenceQuery'

/**
 * Phase 229 (M22) - the pure half of plain-sentence search (MILESTONE22_DESIGN 9). No Electron, DOM, model, network or I/O.
 * Phase 228 parses; this module decides WHAT to fetch from the existing History search / lists, filters the fetched bills by the
 * structured parts, edits the sentence when the owner fixes or removes a chip, and (only when a model answered) re-orders the
 * item matches. Re-ranking only ever REORDERS bills the text search already matched, so protected tokens (numbers, sizes, units)
 * are enforced by the text search and by the main side, never loosened here.
 */

/** A sentence search is on only when the parser found something besides plain item words (otherwise History behaves as before). */
export function isSentenceSearch(p: ParsedSentence): boolean {
  return p.chips.some((c) => c.kind !== 'item')
}

/** How to get the candidate bills from the existing repos. `text` is a History search query ('' = none). */
export interface SearchPlan {
  /** `text`: item words; `party`: the party name only; `lists`: no words at all, walk the dates (From / To, else every date). */
  mode: 'text' | 'party' | 'lists'
  text: string
  from?: string
  to?: string
}

/** Narrow two `YYYY-MM-DD` bounds (blank = open) to their overlap; the sentence's range and the History From / To box both apply. */
export function mergeRange(a: { from?: string; to?: string }, b: { from?: string; to?: string }): { from?: string; to?: string } {
  const from = [a.from, b.from].filter((x): x is string => !!x).sort().pop()
  const to = [a.to, b.to].filter((x): x is string => !!x).sort()[0]
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) }
}

export function searchPlan(q: StructuredQuery, box: { from?: string; to?: string } = {}): SearchPlan {
  const range = mergeRange(q.dateRange ?? {}, box)
  const item = q.itemText.trim()
  if (item !== '') return { mode: 'text', text: item, ...range }
  if (q.party) return { mode: 'party', text: q.party.name, ...range }
  return { mode: 'lists', text: '', ...range }
}

export type BillFormat = 'gst' | 'nongst'

const sameParty = (billParty: string, name: string): boolean => normalizePartyName(billParty) === normalizePartyName(name)

/**
 * Keep the bills that satisfy every structured part: the party (an ambiguous party keeps ANY of its candidates until the owner picks one),
 * the date range (inclusive), the amount (strictly above / below the grand total) and the format. `formatOf` answers 'gst' / 'nongst'
 * or undefined when the format of a bill is unknown; an unknown format is kept (never hidden by a guess) and counted by the caller.
 */
export function filterBills<T extends BillListItem>(bills: readonly T[], q: StructuredQuery, formatOf?: (id: string) => BillFormat | undefined): T[] {
  const names = q.party ? [q.party.name, ...(q.party.candidates ?? []).map((c) => c.name)] : []
  const limit = q.amount ? tryD(q.amount.value) : null
  return bills.filter((b) => {
    if (q.dateRange && (b.billDate < q.dateRange.from || b.billDate > q.dateRange.to)) return false
    if (names.length > 0 && !names.some((n) => sameParty(b.partyName, n))) return false
    if (q.amount) {
      const have = tryD(b.grandTotal)
      if (have === null || limit === null) return false
      if (q.amount.op === 'gt' ? !have.gt(limit) : !have.lt(limit)) return false
    }
    if (q.format && formatOf) {
      const f = formatOf(b.id)
      if (f !== undefined && f !== q.format) return false
    }
    return true
  })
}

// ---------------------------------------------------------------- editing the sentence from a chip
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Replace the chip's source span in the ORIGINAL text (an empty replacement removes it). Out-of-range spans leave the text alone. */
export function replaceSpan(text: string, chip: Pick<QueryChip, 'span'>, replacement: string): string {
  const { start, end } = chip.span
  if (!(start >= 0 && end >= start && end <= text.length)) return text
  return squash(`${text.slice(0, start)} ${replacement} ${text.slice(end)}`)
}

export const removeChipText = (text: string, chip: QueryChip): string => replaceSpan(text, chip, '')

/** The words the chip was read from (what the owner edits). */
export const chipSource = (text: string, chip: QueryChip): string => text.slice(chip.span.start, chip.span.end)

/** Picking one of an ambiguous party's choices. "for" is a party marker word the parser reads back to the same customer. */
export const pickPartyText = (text: string, chip: QueryChip, name: string): string => replaceSpan(text, chip, `for ${name}`)

const dmy = (iso: string): string => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }
/** A date range as the day-first words the parser understands ("01/10/2026 to 31/10/2026"). */
export const rangeWords = (from: string, to: string): string => (from === to ? dmy(from) : `${dmy(from)} to ${dmy(to)}`)

// ---------------------------------------------------------------- re-rank
/** Weight of the model's score against the text-search position (0 = text order only, 1 = model only). */
export const RERANK_WEIGHT = 0.5

/**
 * Re-order `ids` (best text match first) by blending each bill's position with its model score (0..1; missing = 0). Stable for ties, a
 * pure permutation of `ids` (nothing is added or dropped), and the identity when no bill has a score.
 */
export function rerankIds(ids: readonly string[], scores: Readonly<Record<string, number>>, weight = RERANK_WEIGHT): string[] {
  const n = ids.length
  if (n < 2 || !ids.some((id) => (scores[id] ?? 0) > 0)) return [...ids]
  const w = Math.min(1, Math.max(0, weight))
  const key = (id: string, i: number): number => {
    const s = scores[id]
    const sc = typeof s === 'number' && Number.isFinite(s) ? Math.min(1, Math.max(0, s)) : 0
    return w * sc + (1 - w) * (1 - i / n)
  }
  return ids.map((id, i) => ({ id, i, k: key(id, i) })).sort((a, b) => b.k - a.k || a.i - b.i).map((x) => x.id)
}

/** What the History page shows under the search box for a sentence. */
export interface SentenceView {
  chips: QueryChip[]
  /** The original sentence the chips' spans refer to. */
  text: string
  /** The model re-ordered the item matches. */
  reranked: boolean
  /** The format chip could not be applied to this many bills (their format is unknown); 0 when it was applied or not asked for. */
  formatUnknown: number
}
