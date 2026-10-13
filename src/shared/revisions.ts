import type { Bill } from './types'

/** Phase 44 (pure types + helpers): the shapes the revision list, viewer and restore agree on. */

/** One row of the revisions list (no snapshot parsed in the renderer). */
export interface RevisionSummary {
  /** The bill's revision number this save produced (revision 1 = the first save). */
  revision: number
  /** When it was saved (ISO). */
  savedAt: string
  savedByBranch: string
  billDate: string
  partyName: string
  /** Canonical decimal string from the cached totals, '' when unreadable. */
  grandTotal: string
  itemRowCount: number
  /** True for the newest stored revision when it is the bill as it stands now. */
  isCurrent: boolean
}

export interface RevisionDetail {
  revision: number
  savedAt: string
  savedByBranch: string
  /** The bill exactly as that save stored it (id / PO number / branch are the bill's own). */
  bill: Bill
}

/**
 * What `revisions:restoreToDraft` returns: load `draft` into the editor with `baseline` as "saved" (`billStore.loadDraft`),
 * so the revision's content is an UNSAVED change - the normal Save / Discard prompt and undo apply. Nothing is written.
 */
export interface RestoreDraft {
  draft: Bill
  baseline: Bill
  /** Revision number that was restored (for the status line). */
  fromRevision: number
}

/** `08-10-26 14:05` in the machine's local time; an unparseable value is returned unchanged. */
export function formatRevisionTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const d = new Date(t)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${String(d.getFullYear()).slice(2)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * Which revision is the "previous" one for the comparison: the next lower number in the list (which is newest first),
 * or null for the oldest stored one. Gaps in the numbering (delete / restore bump the number) are fine.
 */
export function previousRevision(list: readonly Pick<RevisionSummary, 'revision'>[], revision: number): number | null {
  let best: number | null = null
  for (const r of list) if (r.revision < revision && (best === null || r.revision > best)) best = r.revision
  return best
}
