/**
 * Phase 108 - grouping (ITEM_SORTER_SPEC section 2 steps 5-9). Pure and deterministic: the same spellings and rules always give the
 * same groups, in the same order, with the same ids. No I/O, no clock, no randomness.
 *
 * Tiers:  AUTO      = a spelling is IN a group (same key after Phase 107, or a rare typo fixed by the safe rule, or an owner merge);
 *         SUGGESTED = a pair of groups the owner may confirm (typo, plural, one differing word); never grouped on its own;
 *         SEPARATE  = everything else.
 * A family (leading brand word) is a display grouping only, never a merge. Owner rules are applied LAST, oldest first, so the newest
 * decision on a pair wins. Names on bills are never rewritten: this only groups.
 */
import { normaliseItem, type NormalisedItem } from './normalise'
import { buildVocabulary, autoTypoFix, typoCandidates, isBrandToken, usesOf, type Vocabulary } from './vocabulary'

export interface ItemSpelling { name: string; count: number; lastUsed?: string }

export type RuleKind = 'merge' | 'split' | 'ignore' | 'family'
/** Mirrors the planned `item_rules` row (ITEM_SORTER_SPEC section 3); keys are Phase 107 keys of the ORIGINAL spellings. */
export interface ItemRuleInput { id: string; kind: RuleKind; keyA: string; keyB?: string; canonical?: string; updatedAt: string; deleted?: boolean }

export type WhyRule = 'most-used' | 'same-key' | 'typo-auto' | 'owner-merge'
export interface Why { rule: WhyRule; text: string }
export interface GroupSpelling { name: string; cleaned: string; note: string; count: number; lastUsed: string | null; originalKey: string; why: Why }

export type SuggestionKind = 'typo' | 'plural' | 'one-word'
export interface Suggestion { kind: SuggestionKind; fromId: string; toId: string; text: string; fromCount: number; toCount: number }

export interface ItemGroup {
  /** Stable id: the group's key (the shared Phase 107 key, after any safe typo fix; for an owner merge the key of the group the owner merged INTO). */
  id: string
  display: string
  count: number
  lastUsed: string | null
  spellings: GroupSpelling[]
  familyId: string | null
  /** Suggested merges this group is part of, either side. */
  suggestions: Suggestion[]
}
export interface ItemFamily { id: string; name: string; groupIds: string[]; count: number }
export interface NotItem { name: string; count: number; reason: string; byOwner: boolean }
export interface GroupingResult { groups: ItemGroup[]; families: ItemFamily[]; notItems: NotItem[]; vocabularySize: number }

/** Words that name a variant, not a spelling of another word: BIG vs SMALL, RED vs BLUE must never be offered as a merge. */
export const SIZE_WORDS: ReadonlySet<string> = new Set(['BIG', 'SMALL', 'MEDIUM', 'LARGE', 'MINI', 'JUMBO', 'TINY', 'LONG', 'SHORT', 'THICK', 'THIN', 'WIDE', 'NARROW'])
export const COLOUR_WORDS: ReadonlySet<string> = new Set(['RED', 'BLUE', 'GREEN', 'BLACK', 'WHITE', 'YELLOW', 'PINK', 'ORANGE', 'PURPLE', 'GREY', 'GRAY', 'BROWN', 'GOLD', 'GOLDEN', 'SILVER', 'MAROON', 'NAVY', 'CREAM', 'BEIGE', 'SKY', 'LIGHT', 'DARK'])
/** A differing word on both sides must be at most this common on one side for a one-word suggestion. */
export const ONE_WORD_RARE_USES = 3

function wordClass(t: string): 'size' | 'colour' | null { return SIZE_WORDS.has(t) ? 'size' : COLOUR_WORDS.has(t) ? 'colour' : null }
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const keyOf = (tokens: string[]): string => [...tokens].sort(cmp).join(' ')
const maxDate = (a: string | null, b: string | null | undefined): string | null => (b && (!a || b > a) ? b : a)

interface Entry { name: string; n: NormalisedItem; count: number; lastUsed: string | null; groupKey: string; why: Why }
interface Work { key: string; entries: Entry[] }

function describeTypo(from: string, to: string): string { return `Typo fix: ${from} -> ${to} (rare spelling, common word)` }

export function groupItems(spellings: ReadonlyArray<ItemSpelling>, rules: ReadonlyArray<ItemRuleInput> = []): GroupingResult {
  // merge identical trimmed names first so the same spelling used on many bills is one entry
  const byName = new Map<string, { count: number; lastUsed: string | null }>()
  for (const s of spellings) {
    const name = s.name.trim()
    if (name === '' || !(s.count > 0)) continue
    const e = byName.get(name) ?? { count: 0, lastUsed: null }
    e.count += s.count
    e.lastUsed = maxDate(e.lastUsed, s.lastUsed)
    byName.set(name, e)
  }
  const merged: ItemSpelling[] = [...byName.entries()].sort((a, b) => cmp(a[0], b[0])).map(([name, e]) => ({ name, count: e.count, ...(e.lastUsed ? { lastUsed: e.lastUsed } : {}) }))

  const active = rules.filter((r) => !r.deleted).slice().sort((a, b) => cmp(a.updatedAt, b.updatedAt) || cmp(a.id, b.id))
  const ignored = new Set(active.filter((r) => r.kind === 'ignore').map((r) => r.keyA))

  // steps 1-2: normalise, split off the non-items
  const entries: Entry[] = []
  const notItems: NotItem[] = []
  for (const s of merged) {
    const n = normaliseItem(s.name)
    if (n.empty) continue
    if (n.nonProduct) { notItems.push({ name: s.name, count: s.count, reason: n.nonProduct.label, byOwner: false }); continue }
    if (ignored.has(n.key)) { notItems.push({ name: s.name, count: s.count, reason: 'Marked not an item by you', byOwner: true }); continue }
    entries.push({ name: s.name, n, count: s.count, lastUsed: s.lastUsed ?? null, groupKey: n.key, why: { rule: 'same-key', text: '' } })
  }

  // step 5: vocabulary from the product lines only
  const vocab: Vocabulary = buildVocabulary(entries.map((e) => ({ name: e.name, count: e.count })))

  // step 6 (auto): rare typos fixed word by word, only the safe rule
  const fixCache = new Map<string, string | null>()
  const fixOf = (t: string): string | null => { if (!fixCache.has(t)) fixCache.set(t, autoTypoFix(vocab, t)?.target ?? null); return fixCache.get(t) ?? null }
  for (const e of entries) {
    const notes: string[] = []
    const tokens = e.n.tokens.map((t) => {
      if (e.n.protectedTokens.includes(t)) return t
      const f = fixOf(t)
      if (f) notes.push(describeTypo(t, f))
      return f ?? t
    })
    if (notes.length > 0) { e.groupKey = keyOf(tokens); e.why = { rule: 'typo-auto', text: notes.join('; ') } }
  }

  // group by key
  const works = new Map<string, Work>()
  for (const e of entries) { const w = works.get(e.groupKey) ?? { key: e.groupKey, entries: [] }; w.entries.push(e); works.set(e.groupKey, w) }

  // step 8: owner rules, oldest first. Assignment is per ORIGINAL key, so a split pulls out only that spelling's key.
  const assign = new Map<string, string>() // originalKey -> group key
  for (const e of entries) assign.set(e.n.key, e.groupKey)
  const familyOverride = new Map<string, string>() // original key -> family name
  const ownerMerged = new Set<string>() // original keys whose group came from an owner merge
  for (const r of active) {
    if (r.kind === 'merge' && r.keyB !== undefined) {
      const ga = assign.get(r.keyA), gb = assign.get(r.keyB)
      if (ga === undefined || gb === undefined || ga === gb) continue
      for (const [k, g] of assign) if (g === gb) { assign.set(k, ga); ownerMerged.add(k) }
      ownerMerged.add(r.keyA)
    } else if (r.kind === 'split' && r.keyB !== undefined) {
      const ga = assign.get(r.keyA), gb = assign.get(r.keyB)
      if (ga === undefined || gb === undefined || ga !== gb) continue
      assign.set(r.keyB, r.keyB)
      ownerMerged.delete(r.keyB)
    } else if (r.kind === 'family' && r.canonical) familyOverride.set(r.keyA, normaliseItem(r.canonical).cleaned)
  }
  const canonicalOf = new Map<string, string>() // group key -> owner display name (newest merge with a canonical wins)
  for (const r of active) if (r.kind === 'merge' && r.canonical && r.keyB !== undefined) { const g = assign.get(r.keyA); if (g !== undefined && g === assign.get(r.keyB)) canonicalOf.set(g, r.canonical) }
  const splitPairs = new Set(active.filter((r) => r.kind === 'split' && r.keyB !== undefined).map((r) => [r.keyA, r.keyB as string].sort(cmp).join('|')))

  // rebuild final groups from the assignment
  const finalWorks = new Map<string, Entry[]>()
  for (const e of entries) {
    const g = assign.get(e.n.key) as string
    if (g !== e.groupKey) { e.groupKey = g; e.why = ownerMerged.has(e.n.key) ? { rule: 'owner-merge', text: 'Merged by you' } : { rule: 'same-key', text: '' } }
    else if (ownerMerged.has(e.n.key)) e.why = { rule: 'owner-merge', text: 'Merged by you' }
    const l = finalWorks.get(g) ?? []; l.push(e); finalWorks.set(g, l)
  }

  const groups: ItemGroup[] = []
  const originalGroupId = new Map<string, string>() // original key -> final group id
  const originalKeysOfGroup = new Map<string, Set<string>>()
  for (const [gk, list] of finalWorks) {
    list.sort((a, b) => b.count - a.count || cmp(a.n.cleaned, b.n.cleaned) || cmp(a.name, b.name))
    const top = list[0] as Entry
    const id = gk
    const display = canonicalOf.get(gk) ?? top.n.cleaned
    const sp: GroupSpelling[] = list.map((e, i) => {
      let why = e.why
      if (why.rule === 'same-key') why = i === 0 && why.text === '' ? { rule: 'most-used', text: 'Most used spelling' } : { rule: 'same-key', text: `Same words as ${display} (case, spacing, order or a note differ)` }
      return { name: e.name, cleaned: e.n.cleaned, note: e.n.note, count: e.count, lastUsed: e.lastUsed, originalKey: e.n.key, why }
    })
    groups.push({ id, display, count: list.reduce((n, e) => n + e.count, 0), lastUsed: list.reduce<string | null>((m, e) => maxDate(m, e.lastUsed), null), spellings: sp, familyId: null, suggestions: [] })
    const set = new Set(list.map((e) => e.n.key)); originalKeysOfGroup.set(id, set)
    for (const k of set) originalGroupId.set(k, id)
  }
  groups.sort((a, b) => b.count - a.count || cmp(a.id, b.id))
  const byId = new Map(groups.map((g) => [g.id, g]))

  // step 6 (suggested): typo / plural / one differing word, between groups; never inside one
  const seen = new Set<string>()
  const suggest = (kind: SuggestionKind, a: ItemGroup, b: ItemGroup, text: string): void => {
    if (a.id === b.id) return
    const [from, to] = a.count < b.count || (a.count === b.count && a.id > b.id) ? [a, b] : [b, a]
    const pair = [from.id, to.id].sort(cmp).join('|')
    if (seen.has(pair)) return
    // a split decision between any members keeps the pair apart for good
    for (const x of originalKeysOfGroup.get(from.id) ?? []) for (const y of originalKeysOfGroup.get(to.id) ?? []) if (splitPairs.has([x, y].sort(cmp).join('|'))) return
    seen.add(pair)
    const s: Suggestion = { kind, fromId: from.id, toId: to.id, text, fromCount: from.count, toCount: to.count }
    from.suggestions.push(s); to.suggestions.push(s)
  }
  const tokensOf = (id: string): string[] => (id === '' ? [] : id.split(' '))
  const candCache = new Map<string, ReturnType<typeof typoCandidates>>()
  const candsOf = (t: string) => { let c = candCache.get(t); if (!c) { c = typoCandidates(vocab, t); candCache.set(t, c) } return c }
  const signature = new Map<string, Array<{ g: ItemGroup; missing: string }>>()
  for (const g of groups) {
    const toks = tokensOf(g.id)
    toks.forEach((t, i) => {
      if (/\d/.test(t)) return
      const rest = toks.filter((_, j) => j !== i)
      // typo + plural: replace one word and look the new key up
      for (const c of candsOf(t)) {
        const other = byId.get(keyOf([...rest, c.target]))
        if (other) suggest('typo', g, other, `${t} may be a typo of ${c.target}`)
      }
      for (const alt of [t + 'S', t + 'ES', t.endsWith('S') ? t.slice(0, -1) : '', t.endsWith('ES') ? t.slice(0, -2) : ''])
        if (alt.length >= 3) { const other = byId.get(keyOf([...rest, alt])); if (other && usesOf(vocab, alt) > 0) suggest('plural', g, other, `${t} / ${alt}: singular and plural`) }
      if (rest.length === 0) return // a one-word name has nothing in common to compare
      const sig = rest.join(' ') + '#' + toks.length
      const l = signature.get(sig) ?? []; l.push({ g, missing: t }); signature.set(sig, l)
    })
  }
  for (const list of signature.values()) {
    if (list.length < 2 || list.length > 40) continue
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i] as { g: ItemGroup; missing: string }, b = list[j] as { g: ItemGroup; missing: string }
      if (a.missing === b.missing) continue
      const ca = wordClass(a.missing), cb = wordClass(b.missing)
      if (ca !== null && ca === cb) continue
      if (Math.min(usesOf(vocab, a.missing), usesOf(vocab, b.missing)) > ONE_WORD_RARE_USES) continue
      suggest('one-word', a.g, b.g, `Same except ${a.missing} / ${b.missing}`)
    }
  }
  for (const g of groups) g.suggestions.sort((x, y) => cmp(x.kind, y.kind) || cmp(x.fromId + x.toId, y.fromId + y.toId))

  // step 7: families = leading brand word (display only)
  const famMap = new Map<string, ItemFamily>()
  for (const g of groups) {
    let fam: string | null = null
    for (const k of originalKeysOfGroup.get(g.id) ?? []) { const o = familyOverride.get(k); if (o) fam = o }
    if (fam === null) {
      const brands = tokensOf(g.id).filter((t) => isBrandToken(vocab, t)).sort((a, b) => usesOf(vocab, b) - usesOf(vocab, a) || cmp(a, b))
      fam = brands[0] ?? null
    }
    if (fam === null) continue
    g.familyId = fam
    const f = famMap.get(fam) ?? { id: fam, name: fam, groupIds: [], count: 0 }
    f.groupIds.push(g.id); f.count += g.count; famMap.set(fam, f)
  }
  const families = [...famMap.values()].sort((a, b) => b.count - a.count || cmp(a.id, b.id))
  notItems.sort((a, b) => b.count - a.count || cmp(a.name, b.name))
  return { groups, families, notItems, vocabularySize: vocab.size }
}

/** Groups with at least `min` sales lines (the owner's "sold at least twice" list). */
export const soldAtLeast = (r: GroupingResult, min: number): ItemGroup[] => r.groups.filter((g) => g.count >= min)
