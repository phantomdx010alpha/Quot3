import type { ActionDef } from './shortcuts'

/** Subsequence fuzzy score: higher is better, -1 = no match. Rewards prefix, word-start and consecutive hits. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (q === '') return 0
  const t = text.toLowerCase()
  let score = 0
  let ti = 0
  let prev = -2
  for (const ch of q) {
    const at = t.indexOf(ch, ti)
    if (at === -1) return -1
    score += 1
    if (at === prev + 1) score += 3
    if (at === 0 || t[at - 1] === ' ') score += 2
    prev = at
    ti = at + 1
  }
  if (t.startsWith(q)) score += 5
  return score - t.length * 0.01
}

/** Filters and ranks palette actions; an empty query returns the list unchanged (registry order). */
export function searchActions(query: string, actions: readonly ActionDef[]): ActionDef[] {
  if (query.trim() === '') return [...actions]
  return actions
    .map((a) => ({ a, s: Math.max(fuzzyScore(query, a.label), fuzzyScore(query, `${a.group} ${a.label}`) - 1) }))
    .filter((x) => x.s >= 0)
    .sort((x, y) => y.s - x.s)
    .map((x) => x.a)
}
