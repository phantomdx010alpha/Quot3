/**
 * Phase 233 (M23) - auto red + bold phrases ("by hand"). Pure: no DOM, no Electron, no Node. MILESTONE23_DESIGN 4.6.
 *
 * After an item-name text change, every configured phrase found in the new text that overlaps or touches the CHANGED span is
 * made red + bold (exactly that character range, via the runs engine). Matches are case-insensitive, whole words only
 * ("by handle" does not match), and any run of spaces in the text counts as one. Idempotent. It only ever ADDS formatting and
 * only looks at the changed span, so a manual "Clear formatting" on a phrase sticks until that text is typed again.
 * Data only: the phrases are plain text and are matched literally (escaped), never evaluated.
 */
import type { Runs } from '../types'
import { length, plain, rangeState, setRedBold } from './runs'

export const AUTO_RED_BOLD_KEYS = { enabled: 'bill.autoRedBold.enabled', phrases: 'bill.autoRedBold.phrases', when: 'bill.autoRedBold.when' } as const
export type AutoRedBoldWhen = 'word' | 'leave'
export interface AutoRedBoldConfig { enabled: boolean; phrases: string[]; when: AutoRedBoldWhen }

/** [A] defaults: ON, one phrase, apply as soon as the word is complete. */
export const AUTO_RED_BOLD_DEFAULTS: Readonly<Record<string, unknown>> = {
  [AUTO_RED_BOLD_KEYS.enabled]: true,
  [AUTO_RED_BOLD_KEYS.phrases]: ['by hand'],
  [AUTO_RED_BOLD_KEYS.when]: 'word'
}
export const AUTO_RED_BOLD_LIMITS = { maxPhrases: 20, maxPhraseLength: 60 } as const

/** One phrase, trimmed with inner whitespace collapsed; '' when unusable. */
export function cleanPhrase(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s+/g, ' ').trim().slice(0, AUTO_RED_BOLD_LIMITS.maxPhraseLength).trim()
}

/** A phrase list from stored data: cleaned, no blanks, no duplicates (case-insensitive), capped. Not an array -> the default list. */
export function normalizePhrases(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...(AUTO_RED_BOLD_DEFAULTS[AUTO_RED_BOLD_KEYS.phrases] as string[])]
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of raw) {
    const c = cleanPhrase(p)
    const k = c.toLowerCase()
    if (c === '' || seen.has(k)) continue
    seen.add(k)
    out.push(c)
    if (out.length >= AUTO_RED_BOLD_LIMITS.maxPhrases) break
  }
  return out
}

/** Phrases typed in Settings as a comma / new-line list. */
export const parsePhraseList = (text: string): string[] => normalizePhrases(text.split(/[,\n]/))

/** Tolerant read of the three stored values: anything unexpected falls back to its default (enabled only turns off for a real `false`). */
export function readAutoRedBold(all: Record<string, unknown>): AutoRedBoldConfig {
  const when = all[AUTO_RED_BOLD_KEYS.when]
  return {
    enabled: all[AUTO_RED_BOLD_KEYS.enabled] !== false,
    phrases: normalizePhrases(all[AUTO_RED_BOLD_KEYS.phrases]),
    when: when === 'leave' ? 'leave' : 'word'
  }
}
export const DEFAULT_AUTO_RED_BOLD: AutoRedBoldConfig = readAutoRedBold({})

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const WORD = '[\\p{L}\\p{N}_]'

/** Every whole-word, case-insensitive occurrence of any phrase in `text` (UTF-16 offsets, end exclusive). */
export function findPhraseRanges(text: string, phrases: readonly string[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  for (const p of phrases) {
    const c = cleanPhrase(p)
    if (c === '') continue
    const body = c.split(' ').map(esc).join('\\s+')
    const re = new RegExp(`(?<!${WORD})${body}(?!${WORD})`, 'giu')
    for (const m of text.matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length })
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end)
}

/** The span of `next`'s text that differs from `prev`'s (common prefix / suffix, never splitting a surrogate pair). */
function changedSpan(oldT: string, newT: string): { start: number; end: number } {
  const max = Math.min(oldT.length, newT.length)
  const pair = (s: string, i: number): boolean => i > 0 && i < s.length && /[\uD800-\uDBFF]/.test(s[i - 1] as string) && /[\uDC00-\uDFFF]/.test(s[i] as string)
  let p = 0
  while (p < max && oldT.charCodeAt(p) === newT.charCodeAt(p)) p++
  if (pair(oldT, p) || pair(newT, p)) p--
  let q = 0
  while (q < max - p && oldT.charCodeAt(oldT.length - 1 - q) === newT.charCodeAt(newT.length - 1 - q)) q++
  if (pair(oldT, oldT.length - q) || pair(newT, newT.length - q)) q--
  return { start: p, end: newT.length - q }
}

const isBoundaryChar = (ch: string | undefined): boolean => ch !== undefined && !new RegExp(WORD, 'u').test(ch)

/**
 * `prev` = the runs before the edit, `next` = the runs after it (already carrying the typing). Returns `next` with the phrases
 * that the edit touched made red + bold, or `next` itself when there is nothing to do.
 * `leaving` (default true) = the cell is being left / committed, so a phrase at the very end counts; with `when: 'word'` and
 * `leaving: false` a phrase counts only once a space or punctuation follows it, with `when: 'leave'` only when leaving.
 */
export function applyAutoRedBold(prev: Runs, next: Runs, cfg: AutoRedBoldConfig, opts: { leaving?: boolean } = {}): Runs {
  if (!cfg.enabled || cfg.phrases.length === 0) return next
  const leaving = opts.leaving !== false
  if (!leaving && cfg.when === 'leave') return next
  const oldT = plain(prev)
  const newT = plain(next)
  if (oldT === newT || newT === '') return next
  const span = changedSpan(oldT, newT)
  let out = next
  for (const m of findPhraseRanges(newT, cfg.phrases)) {
    // The edit must overlap the phrase (a pure delete inside / at the edge of it counts too). Text typed right AFTER an already
    // finished phrase does not re-apply it on commit (so a manual Clear formatting sticks); live typing (`leaving: false`) uses
    // that very boundary character as the "word is finished" signal.
    const hit = span.start === span.end ? m.start <= span.start && span.start <= m.end : m.start < span.end && m.end > span.start
    if (!hit && !(!leaving && span.start === m.end)) continue
    if (!leaving && !(m.end < newT.length && isBoundaryChar(newT[m.end]))) continue // still being typed
    if (m.end > length(out)) continue
    if (rangeState(out, m.start, m.end, 'r') === 'all' && rangeState(out, m.start, m.end, 'b') === 'all') continue // idempotent
    out = setRedBold(out, m.start, m.end)
  }
  return out
}
