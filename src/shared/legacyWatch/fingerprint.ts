/**
 * Phase 158 - content fingerprint for the legacy watcher (MILESTONE15_DESIGN 3.1). Pure: no I/O.
 * SHA-256 of normalised party + ISO date + sorted item lines (normalised name, qty, rate) + adjustments.
 * The PO / bill number is NOT part of it, and neither are phone, transport, GSTIN or format (so a copy saved again under
 * the next PO number has the same fingerprint). The older import fingerprint in `legacyImport/plan.ts` is unchanged.
 */
import { D, tryD } from '../money'
import { normalizePartyName } from '../party/partyLite'
import { sha256Hex } from '../legacyImport/sha256'
import type { LegacyBill } from '../legacyImport/parse'

/** Bump when the recipe below changes; it is part of the hashed text so old and new hashes never compare equal by accident. */
export const CONTENT_FINGERPRINT_VERSION = 1

export interface ContentLine { name: string; qty: string | null; rate: string | null; amt: string | null }
export interface ContentInput {
  party: string
  isoDate: string
  /** Normal item rows (blank rows are skipped by the builder). */
  lines: ContentLine[]
  /** Adjustment amounts (decimal strings), any order. */
  adjustments: string[]
}

/** Lower case, whitespace collapsed, trimmed. Used for line matching and for the fingerprint. */
export function normalizeItemName(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Canonical decimal text ("2.50" and "2.5" agree); anything that is not a number is kept trimmed. */
function numText(v: string | null): string {
  if (v === null) return ''
  const d = tryD(v)
  return d ? D(d).toString() : v.trim()
}

/** The legacy bill as neutral content. Blank item rows (no name, no numbers) are dropped. */
export function contentOfLegacy(lb: LegacyBill): ContentInput {
  const lines: ContentLine[] = []
  const adjustments: string[] = []
  for (const it of lb.items) {
    if (it.kind === 'adjustment') { if (it.amt !== null) adjustments.push(it.amt); continue }
    if (it.name.trim() === '' && it.qty === null && it.rate === null && it.amt === null) continue
    lines.push({ name: it.name, qty: it.qty, rate: it.rate, amt: it.amt })
  }
  return { party: lb.party, isoDate: lb.isoDate, lines, adjustments }
}

/** One canonical text per item line. A typed amount counts only when qty or rate is missing ([A]: amount-only rows must differ). */
function lineKey(l: ContentLine): string {
  const amountOnly = l.qty === null || l.rate === null
  return `${normalizeItemName(l.name)}\t${numText(l.qty)}\t${numText(l.rate)}\t${amountOnly ? numText(l.amt) : ''}`
}

export function contentFingerprintOf(c: ContentInput): string {
  const lines = c.lines.map(lineKey).sort()
  const adj = c.adjustments.map(numText).sort()
  return sha256Hex([`v${CONTENT_FINGERPRINT_VERSION}`, normalizePartyName(c.party), c.isoDate, lines.join('\n'), adj.join(',')].join('|'))
}

export function contentFingerprint(lb: LegacyBill): string {
  return contentFingerprintOf(contentOfLegacy(lb))
}

/** Distinct, non-empty normalised item names (the set used for the shared-lines rule). */
export function itemNameSet(c: ContentInput): string[] {
  return [...new Set(c.lines.map((l) => normalizeItemName(l.name)).filter((n) => n !== ''))].sort()
}
