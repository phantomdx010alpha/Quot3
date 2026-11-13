/** Phase 235 (M23) - price tiers (pure). A tier is a named price level; billing asks for a tier KEY, never a column name. */
import { PRICELIST_LIMITS, type PriceTier } from './types'

/** [A] Seed tiers from the legacy screen (design 11 #16). Users may rename, add or remove them. */
export const SEED_TIERS: readonly { key: string; label: string }[] = [
  { key: 'cash_wo', label: 'cash w/o' },
  { key: 'wholesale_wo', label: 'wholesale w/o' },
  { key: 'cash_gst', label: 'cash+GST' },
  { key: 'credit_gst', label: 'credit gst' }
]

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim()

export function sanitizeTierLabel(raw: unknown): string {
  return typeof raw === 'string' ? Array.from(collapse(raw)).slice(0, PRICELIST_LIMITS.labelMax).join('').trim() : ''
}

/** A tier key from a label: lower-case a-z0-9 and `_`, starts with a letter, capped. '' when nothing usable. */
export function tierKeyFromLabel(label: string): string {
  let k = label.normalize('NFKD').toLowerCase().replace(/\+/g, '_plus_').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_')
  if (k === '') return ''
  if (!/^[a-z]/.test(k)) k = `t_${k}`
  return k.slice(0, PRICELIST_LIMITS.tierKeyMax).replace(/_+$/, '')
}

/** A key not in `usedKeys` (pass every key ever used, including removed tiers, so a key is never reused). */
export function uniqueTierKey(label: string, usedKeys: ReadonlySet<string>): string {
  const base = tierKeyFromLabel(label) || 'tier'
  if (!usedKeys.has(base)) return base
  for (let n = 2; ; n++) {
    const k = `${base.slice(0, PRICELIST_LIMITS.tierKeyMax - String(n).length - 1)}_${n}`
    if (!usedKeys.has(k)) return k
  }
}

const sameLabel = (a: string, b: string): boolean => collapse(a).toLowerCase() === collapse(b).toLowerCase()

export type TierResult = { ok: true; tiers: PriceTier[]; tier: PriceTier } | { ok: false; reason: 'empty' | 'duplicate' | 'limit' | 'missing' }

export function addTier(tiers: readonly PriceTier[], rawLabel: string, id: string, usedKeys: ReadonlySet<string> = new Set()): TierResult {
  const label = sanitizeTierLabel(rawLabel)
  if (label === '') return { ok: false, reason: 'empty' }
  if (tiers.length >= PRICELIST_LIMITS.maxTiers) return { ok: false, reason: 'limit' }
  if (tiers.some((t) => sameLabel(t.label, label))) return { ok: false, reason: 'duplicate' }
  const used = new Set<string>([...usedKeys, ...tiers.map((t) => t.key)])
  const tier: PriceTier = { id, key: uniqueTierKey(label, used), label, position: tiers.length }
  return { ok: true, tiers: [...tiers, tier], tier }
}

/** Renaming changes the label only; the key never changes (columns and settings point at keys). */
export function renameTier(tiers: readonly PriceTier[], key: string, rawLabel: string): TierResult {
  const label = sanitizeTierLabel(rawLabel)
  const cur = tiers.find((t) => t.key === key)
  if (!cur) return { ok: false, reason: 'missing' }
  if (label === '') return { ok: false, reason: 'empty' }
  if (tiers.some((t) => t.key !== key && sameLabel(t.label, label))) return { ok: false, reason: 'duplicate' }
  const tier = { ...cur, label }
  return { ok: true, tiers: tiers.map((t) => (t.key === key ? tier : t)), tier }
}

export function removeTier(tiers: readonly PriceTier[], key: string): PriceTier[] {
  return tiers.filter((t) => t.key !== key).map((t, i) => (t.position === i ? t : { ...t, position: i }))
}

/** Move a tier to a new index (clamped); positions are renumbered 0..n-1. */
export function reorderTier(tiers: readonly PriceTier[], key: string, toIndex: number): PriceTier[] {
  const list = [...tiers].sort((a, b) => a.position - b.position)
  const from = list.findIndex((t) => t.key === key)
  if (from < 0) return list.map((t, i) => ({ ...t, position: i }))
  const [t] = list.splice(from, 1)
  list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, t!)
  return list.map((x, i) => ({ ...x, position: i }))
}

export const tierLabel = (tiers: readonly PriceTier[], key: string | null | undefined): string => tiers.find((t) => t.key === key)?.label ?? ''
