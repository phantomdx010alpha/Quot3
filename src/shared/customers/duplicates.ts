import { sha256Hex } from '../sync/codecV2'
import { normalizePartyName } from '../party/partyLite'

/**
 * Phase 137 (docs/SYNC_SHARED_STORE_SPEC.md section 9) - customers that are the same, and customers that only look alike. Pure.
 *
 *  - EXACT same normalised name = one customer, automatically (deterministic record id + the one-time unify plan).
 *  - SIMILAR names are only ever SUGGESTED (`findPossibleDuplicates`); the owner merges them. Every suggestion names its rule.
 *  - Numbers are protected: two names whose digit-bearing words differ are never suggested (the item sorter's rule, applied here too).
 *  - Deterministic: same input = same output, on every computer. No model, no randomness, no clock. [A]
 */

export interface DupParty {
  id: string
  name: string
  phone: string
  address: string
  transport: string
  /** Live bills linked to this customer. */
  billCount: number
  /** ISO time the customer was created (older wins a tie). */
  createdAt: string
}

// ------------------------------------------------------------------------------------------------------------- record ids

/** uuid-shaped id (version 5 bits) from the first 128 bits of a SHA-256: same text in, same id out, on every computer. */
function uuidFrom(text: string): string {
  const h = sha256Hex(text).slice(0, 32).split('')
  h[12] = '5'
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)
  const s = h.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`
}

/** The record id of the customer called `nameNorm` in organisation `orgId` (spec section 9). `nameNorm` is `normalizePartyName(name)`. */
export const partyRecordId = (orgId: string, nameNorm: string): string => uuidFrom(`quot3|party|${orgId}|${nameNorm}`)

/** The record id of a merge (one per survivor + merged pair, so replaying a merge is the same record). */
export const mergeRecordId = (survivorId: string, mergedId: string): string => uuidFrom(`quot3|party_merge|${survivorId}|${mergedId}`)

/** Order-free key of a pair (the "Not the same" list). */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

// ------------------------------------------------------------------------------------------------------- survivor + fields

/** The survivor of a merge: most bills; tie = oldest; tie = smaller id (so every computer picks the same one). */
export function chooseSurvivor<P extends Pick<DupParty, 'id' | 'billCount' | 'createdAt'>>(a: P, b: P): { survivor: P; merged: P } {
  const aWins = a.billCount !== b.billCount ? a.billCount > b.billCount : a.createdAt !== b.createdAt ? a.createdAt < b.createdAt : a.id < b.id
  return aWins ? { survivor: a, merged: b } : { survivor: b, merged: a }
}

export interface PartyFields { phone: string; address: string; transport: string }

/** The survivor keeps its own phone / address / transport; blanks are filled from the merged customer. */
export function fillBlanks(survivor: PartyFields, merged: PartyFields): PartyFields {
  const pick = (mine: string, theirs: string): string => (mine.trim() !== '' ? mine : theirs)
  return { phone: pick(survivor.phone, merged.phone), address: pick(survivor.address, merged.address), transport: pick(survivor.transport, merged.transport) }
}

export interface UnifyMerge { survivorId: string; mergedId: string }
export interface UnifyPlan { merges: UnifyMerge[]; groups: number }

/**
 * The one-time unify (idempotent): group live customers by normalised name; in each group of two or more keep the survivor (most bills,
 * tie oldest) and merge every other one into it. A second run on the result plans nothing. Order of the result is stable.
 */
export function planUnify(parties: readonly Pick<DupParty, 'id' | 'name' | 'billCount' | 'createdAt'>[]): UnifyPlan {
  const byNorm = new Map<string, Pick<DupParty, 'id' | 'name' | 'billCount' | 'createdAt'>[]>()
  for (const p of parties) {
    const n = normalizePartyName(p.name)
    if (n === '') continue
    const g = byNorm.get(n)
    if (g) g.push(p); else byNorm.set(n, [p])
  }
  const merges: UnifyMerge[] = []
  let groups = 0
  for (const norm of [...byNorm.keys()].sort()) {
    const g = byNorm.get(norm)!
    if (g.length < 2) continue
    groups++
    let survivor = g[0]!
    for (const p of g.slice(1)) survivor = chooseSurvivor(survivor, p).survivor
    for (const p of [...g].sort((x, y) => x.id.localeCompare(y.id))) if (p.id !== survivor.id) merges.push({ survivorId: survivor.id, mergedId: p.id })
  }
  return { merges, groups }
}

// ------------------------------------------------------------------------------------------------------ similar names

/** Words that carry no identity ("Ltd", "Pvt", "Co", "M/s"...). */
const NOISE = new Set(['ltd', 'limited', 'pvt', 'private', 'co', 'company', 'inc', 'llp', 'corp', 'corporation', 'and', 'the', 'ms', 'm', 's', 'of'])

export type DuplicateRule = 'same-core' | 'one-letter' | 'starts-with'

export interface DuplicatePair {
  /** The customer that would be kept (`chooseSurvivor`). */
  survivorId: string
  /** The one that would be merged into it. */
  mergedId: string
  rule: DuplicateRule
  /** One plain sentence saying why the two are suggested. */
  reason: string
}

interface Entry { p: DupParty; core: string[]; coreText: string; digits: string }

/** Words of a name: lower-case letters and digits only, plural "s" dropped from long words, noise words removed. */
export function coreWords(name: string): string[] {
  const words = normalizePartyName(name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter((w) => w !== '')
  const out: string[] = []
  for (const w of words) {
    if (NOISE.has(w)) continue
    out.push(w.length > 3 && /[^\d]s$/.test(w) && !/\d/.test(w) ? w.slice(0, -1) : w)
  }
  return out
}

const digitWords = (core: readonly string[]): string => core.filter((w) => /\d/.test(w)).sort().join(' ')

/** True when `a` and `b` differ by exactly one inserted, removed or changed letter (both at least 5 long, neither contains a digit). */
export function oneLetterApart(a: string, b: string): boolean {
  if (a === b || a.length < 5 || b.length < 5 || /\d/.test(a) || /\d/.test(b) || Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  const [s, l] = a.length < b.length ? [a, b] : [b, a]
  return s.slice(i) === l.slice(i + 1)
}

function ruleFor(x: Entry, y: Entry): { rule: DuplicateRule; reason: string } | null {
  if (x.digits !== y.digits) return null // numbers and sizes are protected: never suggested when they differ
  if (x.core.length === 0 || y.core.length === 0) return null
  if (x.coreText === y.coreText) return { rule: 'same-core', reason: 'Same name apart from Ltd / Pvt, a plural or punctuation' }
  if (x.core.length === y.core.length) {
    let diff = -1
    for (let i = 0; i < x.core.length; i++) {
      if (x.core[i] === y.core[i]) continue
      if (diff !== -1) return null
      diff = i
    }
    if (diff !== -1 && oneLetterApart(x.core[diff]!, y.core[diff]!)) return { rule: 'one-letter', reason: 'One word differs by a single letter' }
    return null
  }
  const [s, l] = x.core.length < y.core.length ? [x, y] : [y, x]
  if (s.core.length >= 2 && s.core.every((w, i) => l.core[i] === w)) return { rule: 'starts-with', reason: 'One name is the start of the other' }
  return null
}

const RULE_ORDER: Readonly<Record<DuplicateRule, number>> = { 'same-core': 0, 'one-letter': 1, 'starts-with': 2 }
/** Customers sharing the first three letters of the first word are compared with each other; a bucket larger than this is compared in a sliding window. */
const BUCKET_FULL_MAX = 300
const BUCKET_WINDOW = 40

/**
 * Pairs of live customers whose names are SIMILAR but not equal (an equal normalised name is the unify's job, never listed here).
 * `notSame` holds `pairKey`s the owner rejected. At most `limit` pairs, strongest rule first, then by name. Blocking by the first letters of
 * the first word keeps this fast on tens of thousands of customers.
 */
export function findPossibleDuplicates(parties: readonly DupParty[], opts: { notSame?: ReadonlySet<string>; limit?: number } = {}): DuplicatePair[] {
  const limit = opts.limit ?? 200
  const entries: Entry[] = []
  for (const p of parties) {
    const core = coreWords(p.name)
    if (core.length > 0) entries.push({ p, core, coreText: core.join(' '), digits: digitWords(core) })
  }
  const buckets = new Map<string, Entry[]>()
  for (const e of entries) {
    const k = e.core[0]!.slice(0, 3)
    const b = buckets.get(k)
    if (b) b.push(e); else buckets.set(k, [e])
  }
  const found: Array<DuplicatePair & { sortName: string }> = []
  const seen = new Set<string>()
  const consider = (x: Entry, y: Entry): void => {
    if (x.p.id === y.p.id) return
    if (normalizePartyName(x.p.name) === normalizePartyName(y.p.name)) return
    const key = pairKey(x.p.id, y.p.id)
    if (seen.has(key)) return
    seen.add(key)
    if (opts.notSame?.has(key)) return
    const r = ruleFor(x, y)
    if (!r) return
    const { survivor, merged } = chooseSurvivor(x.p, y.p)
    found.push({ survivorId: survivor.id, mergedId: merged.id, rule: r.rule, reason: r.reason, sortName: normalizePartyName(survivor.name) })
  }
  for (const k of [...buckets.keys()].sort()) {
    const b = buckets.get(k)!.sort((x, y) => x.coreText.localeCompare(y.coreText) || x.p.id.localeCompare(y.p.id))
    for (let i = 0; i < b.length; i++) {
      const to = b.length <= BUCKET_FULL_MAX ? b.length : Math.min(b.length, i + 1 + BUCKET_WINDOW)
      for (let j = i + 1; j < to; j++) consider(b[i]!, b[j]!)
    }
  }
  found.sort((a, b) => RULE_ORDER[a.rule] - RULE_ORDER[b.rule] || a.sortName.localeCompare(b.sortName) || a.survivorId.localeCompare(b.survivorId) || a.mergedId.localeCompare(b.mergedId))
  return found.slice(0, limit).map(({ sortName: _s, ...pair }) => pair)
}

// ------------------------------------------------------------------------------------------------------------- IPC shapes

/** A customer as the "Possible duplicates" list shows it. */
export interface DuplicateParty { id: string; name: string; phone: string; address: string; transport: string; billCount: number }
export interface DuplicateSuggestion extends DuplicatePair { survivor: DuplicateParty; merged: DuplicateParty }
export interface MergeResult { survivorId: string; mergedId: string; billsMoved: number }
export interface UnifyResult { groups: number; merged: number; billsMoved: number }
export interface UndoMergeResult { undone: number; billsMoved: number }
