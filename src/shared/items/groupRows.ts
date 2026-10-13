/**
 * Phase 113 - the Groups window rows (pure): families -> variants, and the Spellings window rows (spellings, then suggested merges).
 * Nothing here returns a stored array: callers build these inside `useMemo` (Phase 92 selector rule).
 */
import type { GroupDetail, GroupSummary } from './api'
import type { GroupSpelling, ItemFamily, Suggestion } from './grouping'
import { isListKey, moveListIndex } from '../history/historyList'

export type GroupRow =
  | { kind: 'family'; key: string; name: string; count: number; groups: number }
  | { kind: 'group'; key: string; group: GroupSummary }

/** Family header, then its variants (most sold first, as `groups` arrives); items without a family come last under "Other items". */
export function buildGroupRows(groups: readonly GroupSummary[], families: readonly ItemFamily[]): GroupRow[] {
  const byId = new Map<string, GroupSummary>()
  for (const g of groups) byId.set(g.id, g)
  const used = new Set<string>()
  const out: GroupRow[] = []
  for (const f of families) {
    const members: GroupSummary[] = []
    for (const id of f.groupIds) { const g = byId.get(id); if (g && !used.has(id)) { members.push(g); used.add(id) } }
    if (members.length === 0) continue
    out.push({ kind: 'family', key: `f:${f.id}`, name: f.name, count: members.reduce((n, g) => n + g.count, 0), groups: members.length })
    for (const g of members) out.push({ kind: 'group', key: `g:${g.id}`, group: g })
  }
  const rest = groups.filter((g) => !used.has(g.id))
  if (rest.length > 0) {
    if (out.length > 0) out.push({ kind: 'family', key: 'f:', name: 'Other items', count: rest.reduce((n, g) => n + g.count, 0), groups: rest.length })
    for (const g of rest) out.push({ kind: 'group', key: `g:${g.id}`, group: g })
  }
  return out
}

/** The group ids in display order (headers skipped). */
export const groupIdsOf = (rows: readonly GroupRow[]): string[] => rows.flatMap((r) => (r.kind === 'group' ? [r.group.id] : []))

/** Where the highlighted group sits among the rows (-1 = none), for scrolling. */
export const rowIndexOfGroup = (rows: readonly GroupRow[], id: string | null): number => (id === null ? -1 : rows.findIndex((r) => r.kind === 'group' && r.group.id === id))

/** Up / Down / Home / End / PageUp / PageDown over the groups only (family headers are skipped). Returns the new group id, or null for an empty list. */
export function moveGroupSelection(rows: readonly GroupRow[], selectedId: string | null, key: string, page = 10): string | null {
  if (!isListKey(key)) return selectedId
  const ids = groupIdsOf(rows)
  const i = moveListIndex(selectedId === null ? -1 : ids.indexOf(selectedId), ids.length, key, page)
  return i < 0 ? null : (ids[i] ?? null)
}

export type SpellingRow =
  | { kind: 'spelling'; key: string; spelling: GroupSpelling }
  | { kind: 'suggestion'; key: string; suggestion: Suggestion; /** The group this one would merge INTO (the more used side). */ intoName: string; /** The group that would be merged (the less used side). */ fromName: string }

/** Spellings (most used first, as sent), then the suggested merges of this group. `nameOf` turns a group id into its display name. */
export function buildSpellingRows(detail: GroupDetail, nameOf: (groupId: string) => string): SpellingRow[] {
  const out: SpellingRow[] = detail.spellings.map((s, i) => ({ kind: 'spelling', key: `s:${i}:${s.name}`, spelling: s }))
  for (const s of detail.suggestions) out.push({ kind: 'suggestion', key: `x:${s.kind}:${s.fromId}>${s.toId}`, suggestion: s, intoName: nameOf(s.toId), fromName: nameOf(s.fromId) })
  return out
}

export { isListKey }
