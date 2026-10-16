/**
 * Phase 158 - what is an incoming legacy file? (MILESTONE15_DESIGN 3.2-3.3). Pure: no database, files or UI.
 * Order of the rules: exact duplicate -> same bill edited (same party + date, >= SHARED_LINES_THRESHOLD of item lines shared)
 * -> uncertain (same party + date, too few shared lines or two candidates) -> new.
 */
import { normalizePartyName } from '../party/partyLite'
import { contentFingerprintOf, itemNameSet, type ContentInput } from './fingerprint'

/** Share of item lines (by normalised name) two bills need for "same bill, edited". [A] 50 %, owner's number in the design. */
export const SHARED_LINES_THRESHOLD = 0.5

export interface Incoming {
  file: string
  content: ContentInput
  /** File modified time, ms since epoch. */
  mtimeMs: number
}

/** A bill already in Quot3 that came from the legacy folder (or any bill the caller wants matched). */
export interface Candidate {
  billId: string
  content: ContentInput
  /** mtime of the legacy file this bill was last built from; null = unknown (the incoming file then counts as newer, [A]). */
  sourceMtimeMs: number | null
  /** True when the bill was edited inside Quot3 after import (detection decided in Phase 159). Never overwritten. */
  locallyEdited: boolean
}

export type ClassKind = 'new' | 'duplicate' | 'edited' | 'older' | 'review'
export type ReviewWhy = 'few_shared_lines' | 'two_candidates' | 'locally_edited'

export interface Classification {
  kind: ClassKind
  /** Bill ids involved: the duplicate / edited / older match, or every candidate for a review. Empty for 'new'. */
  candidates: string[]
  reason: string
  /** Set only when kind is 'review'. */
  why?: ReviewWhy
}

export interface ClassifyCtx { threshold?: number }

/** Shared names / the larger distinct-name count, 0 when either side has no named lines. Symmetric. */
export function sharedLinesRatio(a: ContentInput, b: ContentInput): number {
  const na = itemNameSet(a), nb = itemNameSet(b)
  if (na.length === 0 || nb.length === 0) return 0
  const set = new Set(nb)
  let shared = 0
  for (const n of na) if (set.has(n)) shared++
  return shared / Math.max(na.length, nb.length)
}

export function classify(incoming: Incoming, candidates: readonly Candidate[], ctx: ClassifyCtx = {}): Classification {
  const threshold = ctx.threshold ?? SHARED_LINES_THRESHOLD
  const fp = contentFingerprintOf(incoming.content)
  const sorted = [...candidates].sort((a, b) => (a.billId < b.billId ? -1 : a.billId > b.billId ? 1 : 0)) // result independent of input order

  const same = sorted.find((c) => contentFingerprintOf(c.content) === fp)
  if (same) return { kind: 'duplicate', candidates: [same.billId], reason: 'Same content as an existing bill (the PO number is ignored).' }

  const party = normalizePartyName(incoming.content.party)
  const related = sorted.filter((c) => c.content.isoDate === incoming.content.isoDate && normalizePartyName(c.content.party) === party)
  if (related.length === 0) return { kind: 'new', candidates: [], reason: 'No bill of this party on this date.' }

  const matches = related.filter((c) => sharedLinesRatio(incoming.content, c.content) >= threshold)
  if (matches.length === 0) {
    return { kind: 'review', why: 'few_shared_lines', candidates: related.map((c) => c.billId), reason: 'Same party and date, but fewer than half of the item lines are shared.' }
  }
  if (matches.length > 1) {
    return { kind: 'review', why: 'two_candidates', candidates: matches.map((c) => c.billId), reason: 'More than one existing bill looks like the same bill.' }
  }
  const m = matches[0]!
  const stored = m.sourceMtimeMs ?? Number.NEGATIVE_INFINITY
  if (incoming.mtimeMs <= stored) {
    return { kind: 'older', candidates: [m.billId], reason: 'The existing bill was built from a file that is the same age or newer; this copy is ignored.' }
  }
  if (m.locallyEdited) {
    return { kind: 'review', why: 'locally_edited', candidates: [m.billId], reason: 'A newer legacy copy exists, but the bill was edited in Quot3 after import.' }
  }
  return { kind: 'edited', candidates: [m.billId], reason: 'Newer copy of the same bill: update the existing bill as a new revision.' }
}
