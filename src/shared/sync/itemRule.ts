import { z } from 'zod'
import { ITEM_RULE_KINDS, checkItemRule, type ItemRuleRow } from '../items/rules'
import { incomingWins, type VersionStamp } from './pull'

/**
 * Phase 111: the `item_rule` snapshot kind (docs/SYNC_POSTBOX_SPEC.md section 11). Pure.
 * A rule travels like a bill: one encrypted postbox row per other branch. The postbox `bill_id` column carries the RULE id (a
 * deterministic uuid, so two branches making the same decision use the same id) and the revision is always 0 (rules have no
 * revision counter; the version is `updatedAt`, then the branch that made it). The payload is told apart from a bill snapshot by
 * `kind: 'item_rule'`. A branch that does not know the kind ignores it (see `pullWorker`), and unknown extra fields are stripped.
 */
export const ITEM_RULE_SNAPSHOT_KIND = 'item_rule' as const
/** Wire revision of every rule row (also the AAD revision). */
export const ITEM_RULE_REVISION = 0

export const itemRuleSnapshotSchema = z.object({
  v: z.literal(1),
  kind: z.literal(ITEM_RULE_SNAPSHOT_KIND),
  rule: z.object({
    id: z.string().uuid(),
    kind: z.enum(ITEM_RULE_KINDS),
    keyA: z.string().min(1).max(1000),
    keyB: z.string().max(1000),
    canonical: z.string().max(1000).nullable(),
    note: z.string().max(1000).nullable(),
    createdAt: z.string().min(1).max(40),
    updatedAt: z.string().min(1).max(40),
    deletedAt: z.string().min(1).max(40).nullable(),
    branchId: z.string().min(1).max(100)
  }),
  deleted: z.boolean()
})
export type ItemRuleSnapshot = z.infer<typeof itemRuleSnapshotSchema>

/** True when a decrypted payload says it is an item rule (so the bill schema is not applied to it). */
export const isItemRulePayload = (plain: unknown): boolean =>
  typeof plain === 'object' && plain !== null && (plain as { kind?: unknown }).kind === ITEM_RULE_SNAPSHOT_KIND

/** The payload the push worker seals for a rule row. */
export function itemRuleSnapshot(r: ItemRuleRow): ItemRuleSnapshot {
  return {
    v: 1, kind: ITEM_RULE_SNAPSHOT_KIND,
    rule: { id: r.id, kind: r.kind, keyA: r.keyA, keyB: r.keyB, canonical: r.canonical, note: r.note, createdAt: r.createdAt, updatedAt: r.updatedAt, deletedAt: r.deletedAt, branchId: r.branchId },
    deleted: r.deletedAt !== null
  }
}

/** The ordering stamp of a rule version: same rule as bills (newer `updatedAt`, then branch id; revision is 0 on both sides). */
export const itemRuleStamp = (r: Pick<ItemRuleRow, 'updatedAt' | 'branchId'>): VersionStamp => ({ updatedAt: r.updatedAt, revision: ITEM_RULE_REVISION, branchId: r.branchId })

/** True when the incoming version of a rule beats the local one. Equal = same version = not a win (applying twice changes nothing). */
export const itemRuleIncomingWins = (local: ItemRuleRow | null, incoming: ItemRuleRow): boolean =>
  incomingWins(local ? itemRuleStamp(local) : null, itemRuleStamp(incoming))

/**
 * What the decision SAYS, ignoring who made it and when. Two branches making the same decision (same kind, keys, name, note, both live
 * or both deleted) have the same fingerprint, so the later arrival is dropped instead of rewriting the row (decision dedupe).
 */
export const itemRuleFingerprint = (r: Pick<ItemRuleRow, 'kind' | 'keyA' | 'keyB' | 'canonical' | 'note' | 'deletedAt'>): string =>
  JSON.stringify([r.kind, r.keyA, r.keyB, r.canonical ?? null, r.note ?? null, r.deletedAt !== null])

export type IncomingRuleCheck = { ok: true; rule: ItemRuleRow } | { ok: false; error: string }

/**
 * Checks an incoming rule against the envelope of its postbox row and against the local rules (keys re-normalised, id re-derived).
 * Never throws: a bad rule is reported so the caller can drop it WITHOUT blocking the pipeline behind it.
 */
export function checkIncomingRule(meta: { billId: string; op: 'upsert' | 'delete'; revision: number; updatedAt: string }, snap: ItemRuleSnapshot): IncomingRuleCheck {
  const r = snap.rule
  if (r.id !== meta.billId || meta.revision !== ITEM_RULE_REVISION || r.updatedAt !== meta.updatedAt) return { ok: false, error: 'The rule does not match its envelope (id, revision or time).' }
  if (snap.deleted !== (r.deletedAt !== null) || (meta.op === 'delete') !== snap.deleted) return { ok: false, error: 'The rule disagrees with itself about being deleted.' }
  const c = checkItemRule({ kind: r.kind, keyA: r.keyA, keyB: r.keyB, canonical: r.canonical, note: r.note })
  if (!c.ok) return { ok: false, error: c.error }
  if (c.id !== r.id || c.draft.keyA !== r.keyA || c.draft.keyB !== r.keyB) return { ok: false, error: 'The rule keys do not match its id (made with different matching rules).' }
  return { ok: true, rule: { id: r.id, ...c.draft, createdAt: r.createdAt, updatedAt: r.updatedAt, deletedAt: r.deletedAt, branchId: r.branchId } }
}
