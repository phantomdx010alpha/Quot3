/**
 * Phase 234 (M23) - the Case button: item names UPPER <-> lower (and an optional Title mode). Pure: no DOM, no Electron, no Node.
 *
 * Each run's text is transformed on its own, so per-character bold / red / highlight stay on the same letters, including where
 * the length changes ("\u00DF" -> "SS" stays inside its own run). Uses the locale-independent `toUpperCase` / `toLowerCase`
 * (never the Turkish-style locale versions). Offsets elsewhere are never stored, so nothing else needs fixing up.
 * A Greek final sigma at a run boundary may lowercase to the medial form; that is cosmetic [A].
 */
import type { Run, Runs } from '../types'
import { normalize, plain } from './runs'

export type CaseMode = 'upper' | 'lower' | 'title'

const WORD_CHAR = /[\p{L}\p{N}]/u

function titleCase(runs: Runs): Runs {
  let inWord = false
  const out: Run[] = []
  for (const r of runs) {
    let t = ''
    for (const ch of r.t) { // by code point: an emoji or a surrogate pair is never split
      const letter = WORD_CHAR.test(ch)
      const joiner: boolean = inWord && (ch === "'" || ch === '\u2019')
      t += letter ? (inWord ? ch.toLowerCase() : ch.toUpperCase()) : ch
      inWord = letter || joiner
    }
    out.push({ ...r, t })
  }
  return out
}

/** The runs with every letter changed to `mode`; flags are untouched. Returns the SAME array when nothing changes. */
export function transformRuns(runs: Runs, mode: CaseMode): Runs {
  let next: Runs
  if (mode === 'title') next = titleCase(runs)
  else next = runs.map((r) => ({ ...r, t: mode === 'upper' ? r.t.toUpperCase() : r.t.toLowerCase() }))
  return plain(next) === plain(runs) ? runs : normalize(next)
}

/** Is every letter of `text` already in `mode`? (text with no letters counts as yes) */
export function isInCase(text: string, mode: 'upper' | 'lower'): boolean {
  return (mode === 'upper' ? text.toUpperCase() : text.toLowerCase()) === text
}

/**
 * The cycle: if every name in scope is already UPPER the button makes them lower, otherwise UPPER. So the first press gives UPPER
 * (names that are mixed or lower), the second lower, the third UPPER again.
 */
export function nextCaseMode(names: readonly string[]): 'upper' | 'lower' {
  const withLetters = names.filter((n) => n.toLowerCase() !== n.toUpperCase())
  return withLetters.length > 0 && withLetters.every((n) => isInCase(n, 'upper')) ? 'lower' : 'upper'
}
