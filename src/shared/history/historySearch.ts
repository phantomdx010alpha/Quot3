import Fuse from 'fuse.js'
import { tryD } from '../money'
import type { BillListItem } from './historyList'
import { legacyRefScore } from '../legacyImport/uiModel'

/**
 * Phase 42 - History search ranking (pure). A query is split on spaces; EVERY word must match the bill somewhere
 * (PO number, party, item text, amount), and a bill's score is the sum of each word's best field score. Equal scores keep the
 * caller's order (newest first). Party names are matched fuzzily (typos) but only after the exact / prefix / contains tiers.
 */
export type MatchField = 'po' | 'party' | 'item' | 'amount' | 'legacy'

export interface SearchCandidate extends BillListItem {
  /** All item names of the bill (`bill_rows.name_plain`) joined by spaces. */
  itemText: string
}
export interface SearchHit extends BillListItem {
  score: number
  matchedOn: MatchField[]
}

export const SEARCH_QUERY_MAX = 200
export const SEARCH_LIMIT_DEFAULT = 500
export const SEARCH_LIMIT_MAX = 1000
/** Fuse threshold for party-word typos (0 exact .. 1 anything): one slip in a 4-5 letter word, two in a 6-letter one. */
export const PARTY_TYPO_THRESHOLD = 0.34
const FUZZY_MIN_LEN = 4

export const normSearch = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()
export const searchTokens = (q: string): string[] => normSearch(q).split(' ').filter((t) => t !== '')

/** `₹ 1,250.50` / `1250.5` -> a Decimal; anything else null. */
function asAmount(token: string): ReturnType<typeof tryD> {
  const t = token.replace(/[₹,]/g, '')
  return /^\d+(\.\d+)?$/.test(t) ? tryD(t) : null
}

interface Field { field: MatchField; score: number }

function poScore(token: string, c: SearchCandidate): number {
  const po = c.poNumber.toLowerCase()
  if (po === token) return 1000
  if (/^\d+$/.test(token) && Number(token) === c.poSeq) return 900
  if (po.startsWith(token)) return 800
  if (token.length >= 2 && po.includes(token)) return 600
  return 0
}

function amountScore(token: string, c: SearchCandidate): number {
  const want = asAmount(token)
  const have = tryD(c.grandTotal)
  if (want === null || have === null) return 0
  if (want.equals(have)) return 900
  // "1250" also finds 1250.50: the whole-rupee part.
  if (!token.includes('.') && want.equals(have.trunc())) return 500
  return 0
}

function partyScore(token: string, norm: string, fuzzy: Map<string, number>): number {
  if (norm === '') return 0
  if (norm === token) return 700
  if (norm.startsWith(token)) return 650
  if (norm.split(' ').some((w) => w.startsWith(token))) return 600
  if (norm.includes(token)) return 500
  let best: number | undefined
  for (const w of norm.split(' ')) { const f = fuzzy.get(w); if (f !== undefined && (best === undefined || f < best)) best = f }
  return best === undefined ? 0 : Math.round(400 - 300 * best) // Fuse score 0 (perfect) .. threshold
}

function itemScore(token: string, itemNorm: string): number {
  if (itemNorm === '') return 0
  if (itemNorm.split(' ').some((w) => w.startsWith(token))) return 350
  return itemNorm.includes(token) ? 300 : 0
}

/**
 * Rank `candidates` (already newest first) for `query`; non-matching bills are dropped. A blank query matches nothing.
 * Returns at most `limit` hits and whether more matched than were returned.
 */
export function rankBills(candidates: readonly SearchCandidate[], query: string, limit = SEARCH_LIMIT_DEFAULT): { hits: SearchHit[]; truncated: boolean } {
  const tokens = searchTokens(query.slice(0, SEARCH_QUERY_MAX))
  if (tokens.length === 0) return { hits: [], truncated: false }
  const cap = Math.min(SEARCH_LIMIT_MAX, Math.max(1, Math.floor(limit)))

  // Typo tolerance: one Fuse over the distinct WORDS of the party names (a typo is made inside one word), queried once per query word.
  const words = [...new Set(candidates.flatMap((c) => normSearch(c.partyName).split(' ')).filter((w) => w.length >= 2))]
  const fuse = words.length > 0 ? new Fuse(words, { threshold: PARTY_TYPO_THRESHOLD, ignoreLocation: true, includeScore: true, minMatchCharLength: 2 }) : null
  const fuzzyByToken = tokens.map((t) => {
    const m = new Map<string, number>()
    if (fuse && t.length >= FUZZY_MIN_LEN && !/^[\d₹,.]+$/.test(t)) for (const r of fuse.search(t)) m.set(r.item, r.score ?? 1)
    return m
  })

  const scored: Array<{ hit: SearchHit; order: number }> = []
  candidates.forEach((c, order) => {
    const partyNorm = normSearch(c.partyName)
    const itemNorm = normSearch(c.itemText)
    let total = 0
    const fields = new Set<MatchField>()
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!
      const options: Field[] = [
        { field: 'po', score: poScore(t, c) },
        { field: 'amount', score: amountScore(t, c) },
        { field: 'party', score: partyScore(t, partyNorm, fuzzyByToken[i]!) },
        { field: 'item', score: itemScore(t, itemNorm) },
        { field: 'legacy', score: legacyRefScore(t, c.legacyRef) }
      ]
      const best = options.reduce((a, b) => (b.score > a.score ? b : a))
      if (best.score === 0) return // this word matches nothing: the bill is out
      total += best.score
      fields.add(best.field)
    }
    const { itemText: _t, ...item } = c
    scored.push({ hit: { ...item, score: total, matchedOn: [...fields] }, order })
  })
  scored.sort((a, b) => b.hit.score - a.hit.score || a.order - b.order)
  return { hits: scored.slice(0, cap).map((s) => s.hit), truncated: scored.length > cap }
}

