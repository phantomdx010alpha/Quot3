/**
 * Phase 108 - learned vocabulary and typo candidates (ITEM_SORTER_SPEC section 2 step 5). Pure and deterministic.
 *
 * The vocabulary is learned from the owner's own bills: how many lines each word appears on and how often it is the FIRST word of a
 * name (that position is what marks a brand). A typo candidate is a rare alphabetic word close to a much more frequent one. Numbers,
 * sizes, fractions and units (protected tokens) are never looked at here: a candidate is only ever a plain word.
 *
 * A candidate is `auto` only when ALL of these hold (otherwise it is a suggestion the owner confirms):
 *   - the typed word is very rare (<= TYPO_AUTO_MAX_SOURCE uses) and the target is very frequent (>= TYPO_AUTO_MIN_TARGET uses, >= 10x),
 *     OR it is a habitual typo (<= TYPO_AUTO_MAX_SOURCE_HABIT uses) of a target at least TYPO_AUTO_HABIT_RATIO x as common [A: added in
 *     Phase 108 because the owner's named typos JUPITOR / GRIPER / BUTTTON / SHAKKTI are each used 5-6 times, above the spec's 2];
 *   - the target is the only candidate that qualifies (an ambiguous word is never fixed on its own);
 *   - the edit is one of the safe kinds below, which is what separates JUPITOR -> JUPITER from STRIKER -> STICKER [A: the edit
 *     whitelist and the length floors are the planner's reading of the spec's examples, not an owner-confirmed list].
 */
import { normaliseItem } from './normalise'

export const TYPO_MIN_RATIO = 10
export const TYPO_AUTO_MAX_SOURCE = 2
export const TYPO_AUTO_MIN_TARGET = 30
/** A habitual typo (used up to this often) is also fixed automatically when the target is at least TYPO_AUTO_HABIT_RATIO times as common. [A] */
export const TYPO_AUTO_MAX_SOURCE_HABIT = 10
export const TYPO_AUTO_HABIT_RATIO = 30
/** A word shorter than this is never a typo candidate. */
export const TYPO_MIN_LENGTH = 4
/** Words this long may differ by two edits (suggestion only); shorter ones by one. */
export const TYPO_TWO_EDIT_LENGTH = 7
export const BRAND_MIN_USES = 5
export const BRAND_FIRST_RATIO = 0.6

export interface VocabEntry { uses: number; first: number }
export type Vocabulary = ReadonlyMap<string, VocabEntry>

export interface SpellingCount { name: string; count: number }

/** `uses` = lines a word appears on; `first` = lines where it is the first plain word of a name with more than one word, as typed. */
export function buildVocabulary(spellings: ReadonlyArray<SpellingCount>): Vocabulary {
  const m = new Map<string, VocabEntry>()
  for (const s of spellings) {
    const n = normaliseItem(s.name)
    if (n.empty || n.nonProduct || !(s.count > 0)) continue
    const seen = new Set<string>()
    n.wordTokens.forEach((t, i) => {
      const e = m.get(t) ?? { uses: 0, first: 0 }
      if (!seen.has(t)) { e.uses += s.count; seen.add(t) }
      if (i === 0 && n.tokens.length > 1) e.first += s.count // a one-word name says nothing about position
      m.set(t, e)
    })
  }
  return m
}

export const usesOf = (v: Vocabulary, token: string): number => v.get(token)?.uses ?? 0

/** A brand is a word that is frequent enough and almost always the first word of the name. */
export function isBrandToken(v: Vocabulary, token: string): boolean {
  const e = v.get(token)
  return !!e && e.uses >= BRAND_MIN_USES && e.first / e.uses >= BRAND_FIRST_RATIO
}

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U'])
const isWord = (t: string): boolean => /^\p{L}+$/u.test(t)

export type EditKind = 'repeat' | 'transpose' | 'vowel-sub' | 'consonant-sub' | 'insert-delete' | 'two-edits'
export interface EditInfo { distance: 1 | 2; kind: EditKind; atEnd: boolean }

/** Restricted Damerau-Levenshtein distance (substitution, insertion, deletion, adjacent swap), or null above 2. */
function distance(a: string, b: string): number | null {
  if (Math.abs(a.length - b.length) > 2) return null
  const al = a.length, bl = b.length
  const d: number[][] = []
  for (let i = 0; i <= al; i++) { d[i] = new Array<number>(bl + 1).fill(0); (d[i] as number[])[0] = i }
  for (let j = 0; j <= bl; j++) (d[0] as number[])[j] = j
  for (let i = 1; i <= al; i++) for (let j = 1; j <= bl; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1
    let v = Math.min((d[i - 1] as number[])[j]! + 1, (d[i] as number[])[j - 1]! + 1, (d[i - 1] as number[])[j - 1]! + cost)
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, (d[i - 2] as number[])[j - 2]! + 1)
    ;(d[i] as number[])[j] = v
  }
  const r = (d[al] as number[])[bl]!
  return r <= 2 ? r : null
}

/** What kind of edit turns `a` (typed) into `b` (target); null when they are more than two edits apart or equal. */
export function analyseEdit(a: string, b: string): EditInfo | null {
  if (a === b) return null
  const dist = distance(a, b)
  if (dist === null || dist === 0) return null
  const atEnd = a[a.length - 1] !== b[b.length - 1] || a.length !== b.length && (a.startsWith(b) || b.startsWith(a))
  if (dist === 2) return { distance: 2, kind: 'two-edits', atEnd }
  if (a.length === b.length) {
    let i = 0
    while (a[i] === b[i]) i++
    if (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)) return { distance: 1, kind: 'transpose', atEnd }
    const vowel = VOWELS.has(a[i] as string) || VOWELS.has(b[i] as string)
    return { distance: 1, kind: vowel ? 'vowel-sub' : 'consonant-sub', atEnd: atEnd || i === a.length - 1 }
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a]
  let i = 0
  while (short[i] === long[i]) i++
  // the extra letter equals a neighbour: GRIPER/GRIPPER, BUTTTON/BUTTON, SHAKKTI/SHAKTI
  const repeat = long[i] === long[i - 1] || long[i] === long[i + 1]
  return { distance: 1, kind: repeat ? 'repeat' : 'insert-delete', atEnd }
}

/** The safe-edit whitelist for an automatic fix (see the file header). */
export function isSafeAutoEdit(e: EditInfo, minLen: number): boolean {
  if (e.distance !== 1 || e.atEnd) return false
  switch (e.kind) {
    case 'repeat': case 'transpose': return minLen >= 5
    case 'vowel-sub': return minLen >= 6
    case 'insert-delete': return minLen >= 7
    default: return false
  }
}

export interface TypoCandidate { target: string; targetUses: number; ratio: number; edit: EditInfo; auto: boolean }

const FIRST_LETTER_INDEX = new WeakMap<Vocabulary, Map<string, string[]>>()
/** Words indexed by first letter, so a lookup scans only plausible targets. */
function byFirstLetter(v: Vocabulary): Map<string, string[]> {
  let idx = FIRST_LETTER_INDEX.get(v)
  if (!idx) {
    idx = new Map()
    for (const w of [...v.keys()].sort()) {
      if (!isWord(w) || w.length < TYPO_MIN_LENGTH) continue
      const k = w[0] as string
      const l = idx.get(k)
      if (l) l.push(w); else idx.set(k, [w])
    }
    FIRST_LETTER_INDEX.set(v, idx)
  }
  return idx
}

/** Candidates for one typed word, most frequent target first (ties: alphabetical). Never returns a protected token's neighbours. */
export function typoCandidates(v: Vocabulary, token: string): TypoCandidate[] {
  if (!isWord(token) || token.length < TYPO_MIN_LENGTH) return []
  const own = usesOf(v, token)
  const out: TypoCandidate[] = []
  for (const w of byFirstLetter(v).get(token[0] as string) ?? []) {
    if (w === token || Math.abs(w.length - token.length) > 2) continue
    const tu = usesOf(v, w)
    if (own > 0 ? tu < own * TYPO_MIN_RATIO : tu < 1) continue
    const edit = analyseEdit(token, w)
    if (!edit) continue
    if (edit.distance === 2 && Math.min(token.length, w.length) < TYPO_TWO_EDIT_LENGTH) continue
    out.push({ target: w, targetUses: tu, ratio: own > 0 ? tu / own : Infinity, edit, auto: false })
  }
  out.sort((a, b) => b.targetUses - a.targetUses || (a.target < b.target ? -1 : 1))
  // automatic only for ONE qualifying target (an ambiguous word stays a suggestion)
  const qualifying = out.filter((c) => c.targetUses >= TYPO_AUTO_MIN_TARGET && (own <= TYPO_AUTO_MAX_SOURCE || (own <= TYPO_AUTO_MAX_SOURCE_HABIT && c.targetUses >= own * TYPO_AUTO_HABIT_RATIO)) && isSafeAutoEdit(c.edit, Math.min(token.length, c.target.length)))
  if (qualifying.length === 1 && out.filter((c) => c.edit.distance === 1).length === 1) (qualifying[0] as TypoCandidate).auto = true
  return out
}

/** The one automatic fix for a typed word, or null. */
export function autoTypoFix(v: Vocabulary, token: string): TypoCandidate | null {
  return typoCandidates(v, token).find((c) => c.auto) ?? null
}
