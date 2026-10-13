import { describe, expect, it } from 'vitest'
import { checkItemRule, type ItemRuleRow } from '../../items/rules'
import { remoteSnapshotSchema } from '../pull'
import {
  ITEM_RULE_REVISION, checkIncomingRule, isItemRulePayload, itemRuleFingerprint, itemRuleIncomingWins, itemRuleSnapshot, itemRuleSnapshotSchema
} from '../itemRule'

const mk = (over: Partial<ItemRuleRow> = {}, input: { kind?: 'merge' | 'split' | 'ignore' | 'family'; keyA?: string; keyB?: string; canonical?: string } = {}): ItemRuleRow => {
  const c = checkItemRule({ kind: input.kind ?? 'merge', keyA: input.keyA ?? 'AMETO SMALL', keyB: input.keyB ?? 'AMETO SML', canonical: input.canonical })
  if (!c.ok) throw new Error(c.error)
  return { id: c.id, ...c.draft, createdAt: '2026-10-11T10:00:00.000Z', updatedAt: '2026-10-11T10:00:00.000Z', deletedAt: null, branchId: 'b-1', ...over }
}
const meta = (r: ItemRuleRow) => ({ billId: r.id, op: (r.deletedAt ? 'delete' : 'upsert') as 'upsert' | 'delete', revision: ITEM_RULE_REVISION, updatedAt: r.updatedAt })

describe('Phase 111 - item_rule snapshot', () => {
  it('round-trips through the schema and is told apart from a bill snapshot', () => {
    const r = mk()
    const snap = itemRuleSnapshot(r)
    expect(isItemRulePayload(snap)).toBe(true)
    expect(isItemRulePayload({ v: 1, bill: {}, rows: [], deleted: false })).toBe(false)
    expect(isItemRulePayload(null)).toBe(false)
    expect(itemRuleSnapshotSchema.parse(snap)).toEqual(snap)
    expect(snap.deleted).toBe(false)
    expect(itemRuleSnapshot({ ...r, deletedAt: '2026-10-11T11:00:00.000Z' }).deleted).toBe(true)
  })

  it('old-branch stripping: unknown extra fields are dropped, an unknown snapshot version is refused', () => {
    const snap = itemRuleSnapshot(mk())
    const future = { ...snap, newTopLevel: 1, rule: { ...snap.rule, color: 'red', weight: 3 } }
    const parsed = itemRuleSnapshotSchema.parse(future)
    expect(parsed).toEqual(snap)
    expect(Object.keys(parsed.rule).sort()).toEqual(Object.keys(snap.rule).sort())
    expect(itemRuleSnapshotSchema.safeParse({ ...snap, v: 2 }).success).toBe(false)
    expect(itemRuleSnapshotSchema.safeParse({ ...snap, rule: { ...snap.rule, kind: 'teleport' } }).success).toBe(false)
  })

  it('a build that predates the kind cannot read it as a bill (documented limitation, nothing is applied)', () => {
    expect(remoteSnapshotSchema.safeParse(itemRuleSnapshot(mk())).success).toBe(false)
  })
})

describe('Phase 111 - ordering and decision dedupe', () => {
  it('newer updatedAt wins; equal time falls to the greater branch id; the same version never wins', () => {
    const a = mk({ updatedAt: '2026-10-11T10:00:00.000Z', branchId: 'b-1' })
    expect(itemRuleIncomingWins(null, a)).toBe(true)
    expect(itemRuleIncomingWins(a, mk({ updatedAt: '2026-10-11T10:00:01.000Z', branchId: 'a-0' }))).toBe(true)
    expect(itemRuleIncomingWins(a, mk({ updatedAt: '2026-10-11T09:59:59.000Z', branchId: 'z-9' }))).toBe(false)
    expect(itemRuleIncomingWins(a, mk({ branchId: 'b-2' }))).toBe(true)
    expect(itemRuleIncomingWins(a, mk({ branchId: 'b-0' }))).toBe(false)
    expect(itemRuleIncomingWins(a, a)).toBe(false)
  })

  it('the fingerprint ignores who and when but sees direction, name, note and deletion', () => {
    const base = mk()
    expect(itemRuleFingerprint(base)).toBe(itemRuleFingerprint(mk({ updatedAt: '2027-01-01T00:00:00.000Z', branchId: 'other', createdAt: 'x' })))
    expect(itemRuleFingerprint(base)).not.toBe(itemRuleFingerprint(mk({}, { keyA: 'AMETO SML', keyB: 'AMETO SMALL' }))) // opposite direction
    expect(itemRuleFingerprint(base)).not.toBe(itemRuleFingerprint(mk({}, { canonical: 'Ameto Small' })))
    expect(itemRuleFingerprint(base)).not.toBe(itemRuleFingerprint(mk({ deletedAt: '2026-10-11T11:00:00.000Z' })))
  })

  it('merge ids ignore the order of the pair (two branches choosing opposite sides still share a row)', () => {
    expect(mk({}, { keyA: 'AMETO SMALL', keyB: 'AMETO SML' }).id).toBe(mk({}, { keyA: 'AMETO SML', keyB: 'AMETO SMALL' }).id)
  })
})

describe('Phase 111 - incoming rule checks (never throw)', () => {
  it('accepts a good rule and returns it cleaned', () => {
    const r = mk()
    const c = checkIncomingRule(meta(r), itemRuleSnapshot(r))
    expect(c).toEqual({ ok: true, rule: r })
  })

  it('refuses an envelope that does not match, a wrong revision, a self-contradicting delete', () => {
    const r = mk()
    const snap = itemRuleSnapshot(r)
    expect(checkIncomingRule({ ...meta(r), billId: '00000000-0000-4000-8000-000000000001' }, snap).ok).toBe(false)
    expect(checkIncomingRule({ ...meta(r), revision: 3 }, snap).ok).toBe(false)
    expect(checkIncomingRule({ ...meta(r), updatedAt: '2030-01-01T00:00:00.000Z' }, snap).ok).toBe(false)
    expect(checkIncomingRule({ ...meta(r), op: 'delete' }, snap).ok).toBe(false)
    expect(checkIncomingRule(meta(r), { ...snap, deleted: true }).ok).toBe(false)
  })

  it('refuses keys that are not what this computer would make (stale / foreign matching rules) or an id that does not match them', () => {
    const r = mk()
    const messy = { ...itemRuleSnapshot(r), rule: { ...itemRuleSnapshot(r).rule, keyA: 'ameto   small' } }
    expect(checkIncomingRule(meta(r), messy).ok).toBe(false)
    const otherId = { ...itemRuleSnapshot(r), rule: { ...itemRuleSnapshot(r).rule, id: '00000000-0000-4000-8000-0000000000aa' } }
    expect(checkIncomingRule({ ...meta(r), billId: otherId.rule.id }, otherId).ok).toBe(false)
    const self = { ...itemRuleSnapshot(r), rule: { ...itemRuleSnapshot(r).rule, keyB: itemRuleSnapshot(r).rule.keyA } }
    expect(checkIncomingRule(meta(r), self).ok).toBe(false)
  })
})
