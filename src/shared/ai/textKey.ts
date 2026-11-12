import { normaliseItem } from '../items/normalise'

/**
 * Phase 224 (M22) - the cache key for one item name (pure: no Electron / Node / DOM).
 * The text that is embedded is the NORMALISED name (`shared/items/normalise` clean step: uppercase, separators unified, notes
 * removed) lowercased, in typed order, so "Talco 2044 (red)" and "TALCO-2044" are one cache row. Charge / less / GST lines and
 * empty names have no key (they are not goods and are never embedded).
 */
export interface TextKey { hash: string; text: string }

/** Two independent 32-bit mixes plus the length: 16 hex chars + length, enough that two real item names never collide. */
export function hashText(s: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193 ^ s.length
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 16777619)
    b = Math.imul(b ^ c, 2246822519)
    b = (b << 13) | (b >>> 19)
  }
  const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0')
  return `${hex(a)}${hex(b)}${s.length.toString(16)}`
}

/** The key of one raw item name, or null when it is empty or not goods. Never throws. */
export function textKey(raw: string): TextKey | null {
  const n = normaliseItem(raw)
  if (n.empty || n.nonProduct) return null
  const text = n.cleaned.toLowerCase()
  return { hash: hashText(text), text }
}

/** Distinct keys of many raw names (first spelling wins for `text`; order of first appearance kept). */
export function distinctTextKeys(raws: Iterable<string>): TextKey[] {
  const seen = new Map<string, TextKey>()
  for (const r of raws) {
    const k = textKey(r)
    if (k && !seen.has(k.hash)) seen.set(k.hash, k)
  }
  return [...seen.values()]
}
