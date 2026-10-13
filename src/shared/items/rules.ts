/**
 * Phase 109 - owner item rules: the pure part (ITEM_SORTER_SPEC section 3). Deterministic ids and input cleaning; the SQL is in
 * `main/db/itemRulesRepo.ts`. Keys are Phase 107 keys (`normaliseItem(...).key`) of the ORIGINAL spellings.
 *
 * One decision = one row, however many times or in whichever order it is made:
 *   merge / split : id from kind + the two keys SORTED, so A+B and B+A are the same row (a merge keeps its direction in key_a/key_b:
 *                   key_a is the group merged INTO); the second time round only updates it
 *   ignore        : id from kind + key_a
 *   family        : id from kind + key_a (a group has one family; choosing another updates the row; `canonical` = the family name)
 * The same id on two branches means two branches making the same decision never duplicate (Phase 111).
 */
import { uuidFromText } from '../legacyImport/sha256'
import { normaliseItem } from './normalise'

export const ITEM_RULE_KINDS = ['merge', 'split', 'ignore', 'family'] as const
export type ItemRuleKind = (typeof ITEM_RULE_KINDS)[number]
export const MAX_RULE_KEY = 400
export const MAX_RULE_TEXT = 300

export interface ItemRuleDraft { kind: ItemRuleKind; keyA: string; keyB: string; canonical: string | null; note: string | null }

export interface ItemRuleRow {
  id: string
  kind: ItemRuleKind
  keyA: string
  keyB: string
  canonical: string | null
  note: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  branchId: string
}

export type RuleCheck = { ok: true; draft: ItemRuleDraft; id: string } | { ok: false; error: string }

const clean = (s: unknown, max: number): string => (typeof s === 'string' ? s.trim().slice(0, max) : '')

/** The deterministic row id of a decision (`item-rule|kind|a|b`; the pair is sorted for merge and split). */
export function itemRuleId(kind: ItemRuleKind, keyA: string, keyB = ''): string {
  const pair = kind === 'merge' || kind === 'split' ? [keyA, keyB].sort() : [keyA, '']
  return uuidFromText(`item-rule|${kind}|${pair[0]}|${pair[1]}`)
}

/** Validates and cleans one decision. Never throws. Keys are re-normalised so a hand-typed or stale key cannot slip in. */
export function checkItemRule(input: { kind: unknown; keyA: unknown; keyB?: unknown; canonical?: unknown; note?: unknown }): RuleCheck {
  const kind = input.kind
  if (typeof kind !== 'string' || !(ITEM_RULE_KINDS as readonly string[]).includes(kind)) return { ok: false, error: 'Unknown rule kind.' }
  const k = kind as ItemRuleKind
  const keyA = normaliseItem(clean(input.keyA, MAX_RULE_KEY)).key
  if (keyA === '') return { ok: false, error: 'The item is empty.' }
  const pair = k === 'merge' || k === 'split'
  const keyB = pair ? normaliseItem(clean(input.keyB, MAX_RULE_KEY)).key : ''
  if (pair && keyB === '') return { ok: false, error: 'The second item is empty.' }
  if (pair && keyA === keyB) return { ok: false, error: 'An item cannot be merged with or split from itself.' }
  let canonical: string | null = clean(input.canonical, MAX_RULE_TEXT) || null
  if (k === 'family') {
    canonical = canonical ? normaliseItem(canonical).cleaned || null : null
    if (!canonical) return { ok: false, error: 'A family needs a name.' }
  } else if (k !== 'merge') canonical = null
  const note = clean(input.note, MAX_RULE_TEXT) || null
  return { ok: true, draft: { kind: k, keyA, keyB, canonical, note }, id: itemRuleId(k, keyA, keyB) }
}

/** What the grouping function takes (Phase 108). */
export function toGroupingRule(r: ItemRuleRow): { id: string; kind: ItemRuleKind; keyA: string; keyB?: string; canonical?: string; updatedAt: string; deleted?: boolean } {
  return { id: r.id, kind: r.kind, keyA: r.keyA, ...(r.keyB !== '' ? { keyB: r.keyB } : {}), ...(r.canonical ? { canonical: r.canonical } : {}), updatedAt: r.updatedAt, ...(r.deletedAt ? { deleted: true } : {}) }
}

export type RuleLogOp = 'create' | 'update' | 'revive' | 'delete'
/** Keep at most this many undo steps. */
export const RULE_LOG_KEEP = 200
