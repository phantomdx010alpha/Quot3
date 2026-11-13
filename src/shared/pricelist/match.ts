/**
 * Phase 235 (M23) - deterministic item matcher for billing (pure; NO AI model). Reuses shared/items/normalise (protected tokens).
 * Confident = best score >= T1, margin over the second >= M, and every protected token (digits, sizes, units) equal. [A] thresholds.
 */
import { normaliseItem, type NormalisedItem } from '../items/normalise'

export type Strictness = 'strict' | 'normal' | 'loose'
export const STRICTNESS: Readonly<Record<Strictness, { t1: number; margin: number }>> = {
  strict: { t1: 0.9, margin: 0.15 },
  normal: { t1: 0.75, margin: 0.1 },
  loose: { t1: 0.6, margin: 0.05 }
}
export const MIN_PREFIX = 3
export const CANDIDATE_FLOOR = 0.34

export interface MatchEntry { rowId: string; tabId: string; categoryId?: string; name: string }
export interface MatchIndexEntry extends MatchEntry { norm: NormalisedItem }
export interface MatchCandidate { rowId: string; tabId: string; categoryId?: string; name: string; score: number; protectedEqual: boolean }
export interface MatchResult {
  candidates: MatchCandidate[]
  best: MatchCandidate | null
  confident: boolean
  reason: 'confident' | 'empty' | 'non_product' | 'no_match' | 'ambiguous' | 'protected_differs' | 'low_score'
}

/** Build the index once per Price List change (not per keystroke). Rows with no usable name are skipped. */
export function buildIndex(entries: readonly MatchEntry[]): MatchIndexEntry[] {
  const out: MatchIndexEntry[] = []
  for (const e of entries) {
    const norm = normaliseItem(e.name)
    if (!norm.empty && !norm.nonProduct) out.push({ ...e, norm })
  }
  return out
}

const tokenHit = (a: string, b: string): number => (a === b ? 1 : a.length >= MIN_PREFIX && b.length >= MIN_PREFIX && (a.startsWith(b) || b.startsWith(a)) ? 0.8 : 0)

/** Dice-style overlap over WORD tokens (exact = 1, prefix of 3+ letters = 0.8); each candidate token is used once. Protected tokens are checked separately. */
export function wordScore(q: readonly string[], c: readonly string[]): number {
  if (q.length === 0 && c.length === 0) return 1
  if (q.length === 0 || c.length === 0) return 0
  const used = new Set<number>()
  let sum = 0
  for (const t of q) {
    let bi = -1, bs = 0
    c.forEach((u, i) => { if (used.has(i)) return; const s = tokenHit(t, u); if (s > bs) { bs = s; bi = i } })
    if (bi >= 0) { used.add(bi); sum += bs }
  }
  return (2 * sum) / (q.length + c.length)
}

const sameMulti = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort().join('\u0001') === [...b].sort().join('\u0001')

export function match(query: string, index: readonly MatchIndexEntry[], strictness: Strictness = 'normal', maxCandidates = 5): MatchResult {
  const q = normaliseItem(query)
  if (q.empty) return { candidates: [], best: null, confident: false, reason: 'empty' }
  if (q.nonProduct) return { candidates: [], best: null, confident: false, reason: 'non_product' }
  const scored: MatchCandidate[] = []
  for (const e of index) {
    const protectedEqual = sameMulti(q.protectedTokens, e.norm.protectedTokens)
    let score = q.key === e.norm.key ? 1 : wordScore(q.wordTokens, e.norm.wordTokens)
    if (!protectedEqual) score = Math.min(score, 0.5) // a differing code / size can never be a strong match
    if (score >= CANDIDATE_FLOOR) scored.push({ rowId: e.rowId, tabId: e.tabId, categoryId: e.categoryId, name: e.name, score, protectedEqual })
  }
  scored.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.rowId < b.rowId ? -1 : 1))
  const candidates = scored.slice(0, Math.max(1, maxCandidates))
  const best = candidates[0] ?? null
  if (!best) return { candidates, best: null, confident: false, reason: 'no_match' }
  const { t1, margin } = STRICTNESS[strictness]
  if (!best.protectedEqual) return { candidates, best, confident: false, reason: 'protected_differs' }
  if (best.score < t1) return { candidates, best, confident: false, reason: 'low_score' }
  // identical keys in two places (the same item on two tabs) are ambiguous too: the fill must be unambiguous
  const second = scored[1]
  if (second && best.score - second.score < margin) return { candidates, best, confident: false, reason: 'ambiguous' }
  return { candidates, best, confident: true, reason: 'confident' }
}
