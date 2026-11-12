import { analyseEdit } from '../items/vocabulary'
import { normaliseItem } from '../items/normalise'
import { cosine, type Vec } from './vectorMath'

/**
 * Phase 225 (M22) - the party purchase-history engine (pure: no Electron, Node, DOM, model or I/O; MILESTONE22_DESIGN 7).
 * Given what is typed in the item cell and ONE party's earlier lines, it returns that party's earlier same-looking items:
 * the name used, the format it was billed under, the last rate / qty / date and how often. Suggestions only: a rate is a
 * display string here, never written anywhere, and nothing here touches money.
 *
 * Order of trust (ranked first by tier): 1 = same owner-rule / Items-page group; 2 = near text (typed words are the start of
 * the old name's words, or one safe typo away); 3 = vector cosine at or above the model threshold. A candidate whose protected
 * tokens (numbers, sizes, units: "505" vs "D7", "10 KG" vs "10 MTR") conflict with the typed text is dropped before ranking,
 * in every tier. GST and Non-GST (and other formats) of the same name stay separate results.
 */
export type SuggestTier = 1 | 2 | 3
/** Contract M22-4 reasons. Tier 2 and 3 both read "looks similar"; `explanation` says which. */
export type SuggestWhy = 'your rule' | 'same group' | 'looks similar'

/** One earlier sale line of the party, already read from the bills by the caller. Rates / qty are display strings. */
export interface HistoryLine {
  billId: string
  name: string
  qty: string | null
  /** Unit text when the source has one (the Phase 110 sale line has none yet [A]). */
  unit: string | null
  rate: string | null
  billDate: string
  createdAt: string
  /** The bill's format computes GST (data-driven; never a format name). */
  gst: boolean
  /** Shown on the pill: 'GST', 'Non-GST', or another registered format's name. */
  formatLabel: string
}

export interface PartySuggestion {
  nameUsed: string
  formatLabel: string
  gst: boolean
  lastRate: string | null
  lastQty: string | null
  lastUnit: string | null
  lastDate: string
  timesBought: number
  tier: SuggestTier
  score: number
  why: SuggestWhy
  explanation: string
}

export interface PartyHistoryInput {
  typed: string
  lines: readonly HistoryLine[]
  /** Items-page group of an item name (owner rules already applied), or null. */
  groupIdOf(name: string): string | null
  /** Typed-text vector (model "query:" prefix), when the model is on. */
  typedVector?: Vec | null
  /** Cached vector of an old name, or null when it has none yet. */
  vectorOf?(name: string): Vec | null
  /** `ModelConfig.thresholds.history`. Tier 3 is off without a typed vector. */
  threshold: number
  /** Default 5. */
  max?: number
}

export interface PartyHistoryResult { suggestions: PartySuggestion[]; embeddingsUsed: boolean }

export const HISTORY_MAX = 5
/** Typed text shorter than this many characters (after cleaning) suggests nothing. */
export const MIN_TYPED_CHARS = 2
/** A word this long may differ by one safe edit (tier 2). */
export const NEAR_TYPO_MIN_LENGTH = 5

/** True when the typed protected tokens are not all present in the candidate (typed has "505", candidate only "D7" or nothing). */
export function protectedConflict(typedProtected: readonly string[], candProtected: readonly string[]): boolean {
  if (typedProtected.length === 0) return false
  const have = new Set(candProtected)
  return typedProtected.some((t) => !have.has(t))
}

/** Tier 2 score in (0,1], or null. Every typed word must be the start of (or one safe typo from) a distinct old word. */
export function nearTextScore(typedWords: readonly string[], candWords: readonly string[]): number | null {
  if (typedWords.length === 0 || candWords.length === 0) return null
  const free = candWords.map((_, i) => i)
  for (const tw of typedWords) {
    let at = free.findIndex((i) => candWords[i] === tw)
    if (at < 0) {
      at = free.findIndex((i) => tw.length >= MIN_TYPED_CHARS && (candWords[i] as string).startsWith(tw))
      if (at < 0) {
        at = free.findIndex((i) => {
          const cw = candWords[i] as string
          if (tw.length < NEAR_TYPO_MIN_LENGTH || cw.length < NEAR_TYPO_MIN_LENGTH) return false
          const e = analyseEdit(tw, cw)
          return e !== null && e.distance === 1
        })
      }
    }
    if (at < 0) return null
    free.splice(at, 1)
  }
  const base = typedWords.length / Math.max(candWords.length, typedWords.length)
  return Math.round((0.5 + 0.5 * base) * 1000) / 1000
}

interface Cand { line: HistoryLine; tier: SuggestTier; score: number }

const newer = (a: HistoryLine, b: HistoryLine): number =>
  a.billDate !== b.billDate ? (a.billDate > b.billDate ? -1 : 1) : a.createdAt !== b.createdAt ? (a.createdAt > b.createdAt ? -1 : 1) : a.billId !== b.billId ? (a.billId > b.billId ? -1 : 1) : 0

/** Plain-words reason for one result (also usable as a tooltip). Pure. */
export function explainSuggestion(s: Pick<PartySuggestion, 'tier' | 'score' | 'timesBought' | 'lastRate' | 'lastDate' | 'formatLabel'>): string {
  const how =
    s.tier === 1 ? 'Same item group as what you typed.' : s.tier === 2 ? 'The words you typed match this earlier name.' : `Reads like what you typed (match ${Math.round(s.score * 100)}%).`
  const times = s.timesBought === 1 ? 'Bought once' : `Bought ${s.timesBought} times`
  const rate = s.lastRate ? `, last rate ${s.lastRate}` : ''
  return `${how} ${times} (${s.formatLabel})${rate}, last on ${s.lastDate}.`
}

export function suggestFromHistory(input: PartyHistoryInput): PartyHistoryResult {
  const max = Math.max(1, input.max ?? HISTORY_MAX)
  const typed = normaliseItem(input.typed)
  const none: PartyHistoryResult = { suggestions: [], embeddingsUsed: false }
  if (typed.empty || typed.nonProduct || typed.cleaned.length < MIN_TYPED_CHARS || input.lines.length === 0) return none

  const typedGroup = input.groupIdOf(input.typed.trim())
  const typedWords = typed.wordTokens.map((w) => w.toLowerCase())
  const typedVec = input.typedVector && input.typedVector.length > 0 ? input.typedVector : null
  const embeddingsUsed = typedVec !== null && input.vectorOf !== undefined

  // One decision per distinct old name (a name seen 200 times is judged once).
  const names = new Map<string, HistoryLine[]>()
  for (const l of input.lines) {
    const n = l.name.trim()
    if (n === '') continue
    const list = names.get(n)
    if (list) list.push(l); else names.set(n, [l])
  }
  const cands: Cand[] = []
  for (const [name, lines] of names) {
    const c = normaliseItem(name)
    if (c.empty || c.nonProduct) continue
    if (protectedConflict(typed.protectedTokens, c.protectedTokens)) continue
    let tier: SuggestTier | null = null
    let score = 0
    if (typedGroup !== null && input.groupIdOf(name) === typedGroup) { tier = 1; score = 1 }
    if (tier === null) {
      const s2 = nearTextScore(typedWords, c.wordTokens.map((w) => w.toLowerCase()))
      if (s2 !== null) { tier = 2; score = s2 }
    }
    if (tier === null && typedVec && input.vectorOf) {
      const v = input.vectorOf(name)
      if (v && v.length === typedVec.length) {
        const s3 = cosine(typedVec, v)
        if (s3 >= input.threshold) { tier = 3; score = Math.round(s3 * 1000) / 1000 }
      }
    }
    if (tier === null) continue
    for (const l of lines) cands.push({ line: l, tier, score })
  }

  // Collapse by name + format: the newest line speaks for the group, the count is how often it was bought.
  const merged = new Map<string, { lines: HistoryLine[]; tier: SuggestTier; score: number }>()
  for (const c of cands) {
    const key = `${normaliseItem(c.line.name).key}\u0001${c.line.gst ? 'G' : 'N'}\u0001${c.line.formatLabel}`
    const m = merged.get(key)
    if (!m) merged.set(key, { lines: [c.line], tier: c.tier, score: c.score })
    else { m.lines.push(c.line); if (c.tier < m.tier || (c.tier === m.tier && c.score > m.score)) { m.tier = c.tier; m.score = c.score } }
  }
  const out: PartySuggestion[] = []
  for (const m of merged.values()) {
    const sorted = [...m.lines].sort(newer)
    const last = sorted[0] as HistoryLine
    const priced = sorted.find((l) => l.rate !== null && l.rate !== '')
    const base = { tier: m.tier, score: m.score, timesBought: sorted.length, lastRate: priced?.rate ?? null, lastDate: last.billDate, formatLabel: last.formatLabel }
    out.push({
      nameUsed: last.name.trim(), formatLabel: last.formatLabel, gst: last.gst,
      lastRate: base.lastRate, lastQty: last.qty, lastUnit: last.unit, lastDate: last.billDate,
      timesBought: base.timesBought, tier: m.tier, score: m.score,
      why: m.tier === 1 ? 'same group' : 'looks similar',
      explanation: explainSuggestion(base)
    })
  }
  out.sort((a, b) => a.tier - b.tier || b.score - a.score || (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0) || (a.nameUsed < b.nameUsed ? -1 : a.nameUsed > b.nameUsed ? 1 : 0) || (a.gst === b.gst ? 0 : a.gst ? 1 : -1))
  return { suggestions: out.slice(0, max), embeddingsUsed }
}
