/** Phase 112 - the Items page search box (pure). Matches on the group's display name; deterministic, no fuzzy guessing in the shell. */
import type { GroupSummary } from './api'

/** Upper-case, runs of spaces / dashes / punctuation -> one space, so "ameto  small" finds "AMETO SMALL". */
export function searchNeedle(q: string): string {
  return q.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}%.]+/gu, ' ').trim()
}

/** Groups whose name contains EVERY word of the query (any order). Empty query = all groups, same array (no copy). */
export function filterGroups(groups: readonly GroupSummary[], query: string): readonly GroupSummary[] {
  const needle = searchNeedle(query)
  if (needle === '') return groups
  const words = needle.split(' ')
  return groups.filter((g) => {
    const hay = searchNeedle(g.display)
    return words.every((w) => hay.includes(w))
  })
}

export function describeGroups(shown: number, total: number): string {
  if (total === 0) return 'No items yet'
  const noun = (n: number): string => (n === 1 ? 'item' : 'items')
  return shown === total ? `${total} ${noun(total)}` : `${shown} of ${total} ${noun(total)}`
}
