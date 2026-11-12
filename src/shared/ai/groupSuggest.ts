import { normaliseItem } from '../items/normalise'
import { COLOUR_WORDS, SIZE_WORDS } from '../items/grouping'
import { cosine, normalise, type Vec } from './vectorMath'

/**
 * Phase 227 (M22) - suggested merges between Items-page groups (pure: no Electron, Node, DOM, model or I/O; MILESTONE22_DESIGN 8).
 * For ONE group (the one selected on the Items page) it proposes the other groups that read like it, using group-level vectors:
 * a group is the count-weighted average of its spelling vectors (or, when only some spellings have a cached vector, of those;
 * a group with none is skipped). Suggestions only: nothing here merges, writes a rule or touches a bill; the owner's Accept goes
 * through the existing `decide({ op: 'merge' })` path.
 *
 * Rejected before ranking (never shown): the same group; a pair the rules already suggest or the owner already split; a pair the
 * owner dismissed; pure-GST against pure-Non-GST [A]; different protected tokens (numbers, sizes, units: "505" vs "D7");
 * a differing size / colour word (BIG vs SMALL, RED vs BLUE). Ranked by cosine, which must reach the model's `thresholds.group`.
 */
export type GroupWhy = 'looks similar'

/** The slice of a group this engine reads. `gstCount` / `nonGstCount` = sales of the group on GST / Non-GST bills. */
export interface GroupAiInput {
  id: string
  display: string
  count: number
  gstCount: number
  nonGstCount: number
  /** Spellings with their use counts and the Phase 107 key of the ORIGINAL spelling (rules talk in these keys). */
  spellings: ReadonlyArray<{ name: string; count: number; key: string }>
}

export interface GroupMergeSuggestion {
  /** Stable, order-free id of the pair: what Dismiss remembers. */
  pairKey: string
  /** The less used group: it is the one that would be merged. */
  fromId: string
  fromName: string
  fromCount: number
  /** The more used group: the merge goes INTO it. */
  toId: string
  toName: string
  toCount: number
  /** Cosine of the two group vectors, 0..1, 3 decimals. */
  score: number
  why: GroupWhy
  /** Plain-words reason shown next to the badge. */
  explanation: string
}

export interface GroupSuggestInput {
  /** The group the owner has selected. */
  groupId: string
  groups: readonly GroupAiInput[]
  /** Cached vector of a spelling name, or null when it has none yet. */
  vectorOf(name: string): Vec | null
  /** `ModelConfig.thresholds.group`. */
  threshold: number
  /** Pair keys (`pairKey`) of merges the rules already suggest (they are shown by the rule path, not twice). */
  ruleSuggested?: ReadonlySet<string>
  /** Sorted original-key pairs (`keyPairId`) the owner split ("not the same"): never proposed again. */
  splitKeyPairs?: ReadonlySet<string>
  /** Pair keys the owner dismissed on this PC. */
  dismissed?: ReadonlySet<string>
  /** Default 5. */
  max?: number
}

export const GROUP_SUGGEST_MAX = 5

/** Order-free id of two group ids. */
export function pairKey(a: string, b: string): string { return a < b ? `${a}\u0001${b}` : `${b}\u0001${a}` }
/** Order-free id of two original-spelling keys (the form a `split` rule stores). */
export function keyPairId(a: string, b: string): string { return pairKey(a, b) }

export type GstKind = 'gst' | 'non' | 'mixed' | 'none'
export function gstKind(g: Pick<GroupAiInput, 'gstCount' | 'nonGstCount'>): GstKind {
  if (g.gstCount > 0 && g.nonGstCount === 0) return 'gst'
  if (g.nonGstCount > 0 && g.gstCount === 0) return 'non'
  return g.gstCount > 0 ? 'mixed' : 'none'
}
/** Pure-GST and pure-Non-GST groups are never put together; a mixed group is shown per tab by the Sales window already [A]. */
export function gstCompatible(a: Pick<GroupAiInput, 'gstCount' | 'nonGstCount'>, b: Pick<GroupAiInput, 'gstCount' | 'nonGstCount'>): boolean {
  const x = gstKind(a)
  const y = gstKind(b)
  return !((x === 'gst' && y === 'non') || (x === 'non' && y === 'gst'))
}

const mostUsed = (g: GroupAiInput): string => {
  let best = g.spellings[0]
  for (const s of g.spellings) if (best === undefined || s.count > best.count) best = s
  return best ? best.name : g.display
}

/** Numbers / sizes / units must be identical on both sides; a size or colour word on only one side keeps them apart. */
export function protectedMismatch(a: string, b: string): boolean {
  const na = normaliseItem(a)
  const nb = normaliseItem(b)
  const pa = new Set(na.protectedTokens.map((t) => t.toUpperCase()))
  const pb = new Set(nb.protectedTokens.map((t) => t.toUpperCase()))
  if (pa.size !== pb.size) return true
  for (const t of pa) if (!pb.has(t)) return true
  const wa = new Set(na.wordTokens.map((t) => t.toUpperCase()))
  const wb = new Set(nb.wordTokens.map((t) => t.toUpperCase()))
  for (const w of wa) if (!wb.has(w) && (SIZE_WORDS.has(w) || COLOUR_WORDS.has(w))) return true
  for (const w of wb) if (!wa.has(w) && (SIZE_WORDS.has(w) || COLOUR_WORDS.has(w))) return true
  return false
}

/** Count-weighted average of the spelling vectors that exist, L2-normalised. Null when none has a vector (or they disagree in length). */
export function groupVector(g: GroupAiInput, vectorOf: (name: string) => Vec | null): Float32Array | null {
  let sum: Float32Array | null = null
  for (const s of g.spellings) {
    const v = vectorOf(s.name)
    if (!v || v.length === 0) continue
    if (sum === null) sum = new Float32Array(v.length)
    if (v.length !== sum.length) continue
    const w = Math.max(1, s.count)
    for (let i = 0; i < v.length; i++) sum[i]! += (v[i] as number) * w
  }
  return sum === null ? null : normalise(sum)
}

export function explainGroupMerge(s: { fromName: string; toName: string; fromCount: number; toCount: number; score: number }): string {
  return `Reads like the same item (match ${Math.round(s.score * 100)}%). ${s.fromName} (${s.fromCount}) would join ${s.toName} (${s.toCount}). Check the numbers and sizes before you accept.`
}

const blockedBySplit = (a: GroupAiInput, b: GroupAiInput, split: ReadonlySet<string> | undefined): boolean => {
  if (!split || split.size === 0) return false
  for (const x of a.spellings) for (const y of b.spellings) if (split.has(keyPairId(x.key, y.key))) return true
  return false
}

/** Nearest groups to the selected one, best first. Never throws; an unknown group or no vectors gives []. */
export function suggestGroupMerges(input: GroupSuggestInput): GroupMergeSuggestion[] {
  const max = Math.max(1, input.max ?? GROUP_SUGGEST_MAX)
  const target = input.groups.find((g) => g.id === input.groupId)
  if (!target) return []
  const tv = groupVector(target, input.vectorOf)
  if (!tv) return []
  const tName = mostUsed(target)
  const out: Array<GroupMergeSuggestion & { _i: number }> = []
  input.groups.forEach((g, i) => {
    if (g.id === target.id) return
    const key = pairKey(target.id, g.id)
    if (input.dismissed?.has(key) || input.ruleSuggested?.has(key)) return
    if (!gstCompatible(target, g)) return
    if (protectedMismatch(tName, mostUsed(g))) return
    if (blockedBySplit(target, g, input.splitKeyPairs)) return
    const gv = groupVector(g, input.vectorOf)
    if (!gv || gv.length !== tv.length) return
    const score = cosine(tv, gv)
    if (!(score >= input.threshold)) return
    // the less used side is merged into the more used one; a tie keeps the smaller id as the target of the merge
    const targetIsFrom = target.count < g.count || (target.count === g.count && target.id > g.id)
    const from = targetIsFrom ? target : g
    const to = targetIsFrom ? g : target
    const s: GroupMergeSuggestion = {
      pairKey: key, fromId: from.id, fromName: from.display, fromCount: from.count, toId: to.id, toName: to.display, toCount: to.count,
      score: Math.round(score * 1000) / 1000, why: 'looks similar', explanation: ''
    }
    s.explanation = explainGroupMerge(s)
    out.push({ ...s, _i: i })
  })
  out.sort((a, b) => b.score - a.score || a._i - b._i)
  return out.slice(0, max).map(({ _i, ...s }) => s)
}
