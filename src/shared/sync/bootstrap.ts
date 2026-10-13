import { z } from 'zod'
import { validatePoPrefix } from '../settings/appSettings'

/**
 * Phase 58 (pure): the new-branch bootstrap import (docs/SYNC_POSTBOX_SPEC.md "Bootstrap").
 * A new branch gets the history of an existing branch from a backup file, MERGED into this computer's database
 * (never a restore: the license, branch, settings and sync state of this computer stay exactly as they are).
 */

/** One branch found in the backup file. */
export interface BootstrapBranch {
  id: string
  name: string
  poPrefix: string
  /** Live bills of this branch in the file. */
  bills: number
  /** Bills of this branch this computer does not have yet (they will be added). */
  newBills: number
}

/** What the import WOULD do (a dry run of the real merge, so the counts are the counts of the real thing). */
export interface BootstrapCounts {
  branchesAdded: number
  partiesAdded: number
  billsAdded: number
  rowsAdded: number
  /** Bills this computer already has (same id): kept as they are here. */
  skippedExisting: number
  /** Bills that were in "Recently deleted" in the file: not imported. */
  skippedTrashed: number
  /** Bills that could not be added (same branch and PO sequence as a different bill here, or an unknown branch). */
  skippedClash: number
}

export interface BootstrapPreview extends BootstrapCounts {
  file: string
  /** Branches in the file other than this computer's own. */
  branches: BootstrapBranch[]
  local: { id: string; name: string; poPrefix: string }
  /** An imported branch uses the same PO prefix as this computer: a new prefix is required before importing. */
  prefixClash: boolean
  /** A free prefix to offer (the current one when it is already free). */
  suggestedPrefix: string
  /** Sync is already activated on this computer (changing the prefix then needs a re-activation). */
  activated: boolean
}

export interface BootstrapResult extends BootstrapCounts {
  prefix: string
  prefixChanged: boolean
  activated: boolean
  /** The safety copy of this computer's data made right before the import. */
  safetyBackup: string
}

export const bootstrapPreviewSchema = z.object({ file: z.string().min(1).max(200) }).strict()
export const bootstrapApplySchema = z.object({ file: z.string().min(1).max(200), prefix: z.string().max(40).optional() }).strict()
export type BootstrapApplyInput = z.infer<typeof bootstrapApplySchema>

/** Prefix to offer: `current` when free, else its base with B, C, D ... added (`Q3-` -> `Q3B-`). */
export function suggestFreePrefix(current: string, taken: readonly string[]): string {
  const used = new Set(taken.map((p) => p.toUpperCase()))
  if (!used.has(current.toUpperCase())) return current
  const m = /^(.*?)([-_/]*)$/.exec(current)
  const base = m?.[1] ?? current
  const sep = m?.[2] ?? ''
  for (const letter of 'BCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const p = `${base}${letter}${sep}`
    if (!used.has(p.toUpperCase()) && validatePoPrefix(p, []).ok) return p
  }
  return current
}

/** The prefix to use after the import. `wanted` empty = keep the current one (refused when an imported branch already uses it). */
export function chooseBootstrapPrefix(
  current: string, wanted: string | undefined, importedPrefixes: readonly string[], otherLocalPrefixes: readonly string[]
): { ok: true; prefix: string } | { ok: false; message: string } {
  const raw = wanted === undefined || wanted.trim() === '' ? current : wanted
  const r = validatePoPrefix(raw, [...importedPrefixes, ...otherLocalPrefixes])
  if (!r.ok) {
    const keeping = raw === current
    return { ok: false, message: keeping ? `${r.message} Choose a different prefix for this computer, then import.` : r.message }
  }
  return { ok: true, prefix: r.prefix }
}
