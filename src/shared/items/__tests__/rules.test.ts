import { describe, expect, it } from 'vitest'
import { checkItemRule, itemRuleId, toGroupingRule, type ItemRuleRow } from '../rules'
import { normaliseItem } from '../normalise'
import { groupItems } from '../grouping'

describe('Phase 109 - rule ids and input checks', () => {
  it('ids are deterministic uuids; merge and split ignore the order of the pair', () => {
    expect(itemRuleId('merge', 'A', 'B')).toBe(itemRuleId('merge', 'B', 'A'))
    expect(itemRuleId('split', 'A', 'B')).toBe(itemRuleId('split', 'B', 'A'))
    expect(itemRuleId('merge', 'A', 'B')).not.toBe(itemRuleId('split', 'A', 'B'))
    expect(itemRuleId('merge', 'A', 'B')).not.toBe(itemRuleId('merge', 'A', 'C'))
    expect(itemRuleId('ignore', 'A')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(itemRuleId('ignore', 'A')).toBe(itemRuleId('ignore', 'A'))
  })
  it('keys are re-normalised: a typed name and its key are the same decision', () => {
    const a = checkItemRule({ kind: 'merge', keyA: 'talco 2044', keyB: 'BUTTON  fancy' })
    const b = checkItemRule({ kind: 'merge', keyA: '2044 TALCO', keyB: 'FANCY BUTTON' })
    expect(a.ok && b.ok && a.id === b.id).toBe(true)
    if (a.ok) expect(a.draft).toMatchObject({ keyA: '2044 TALCO', keyB: 'BUTTON FANCY', canonical: null })
  })
  it('refuses empty keys, a self merge, an unknown kind and a nameless family', () => {
    expect(checkItemRule({ kind: 'merge', keyA: '', keyB: 'X' }).ok).toBe(false)
    expect(checkItemRule({ kind: 'merge', keyA: 'X', keyB: ' ' }).ok).toBe(false)
    expect(checkItemRule({ kind: 'split', keyA: 'A B', keyB: 'b a' }).ok).toBe(false)
    expect(checkItemRule({ kind: 'nope', keyA: 'X' }).ok).toBe(false)
    expect(checkItemRule({ kind: 'family', keyA: 'X' }).ok).toBe(false)
    expect(checkItemRule({ kind: 5, keyA: 'X' }).ok).toBe(false)
  })
  it('ignore / family drop a second key; only merge and family keep a name', () => {
    const i = checkItemRule({ kind: 'ignore', keyA: 'sample', keyB: 'zzz', canonical: 'q' })
    expect(i.ok && i.draft).toMatchObject({ keyB: '', canonical: null })
    const f = checkItemRule({ kind: 'family', keyA: 'zip long', canonical: ' spade ' })
    expect(f.ok && f.draft).toMatchObject({ canonical: 'SPADE', keyB: '' })
    const s = checkItemRule({ kind: 'split', keyA: 'a', keyB: 'b', canonical: 'x', note: ' why ' })
    expect(s.ok && s.draft).toMatchObject({ canonical: null, note: 'why' })
  })
  it('a stored row feeds the Phase 108 grouping unchanged', () => {
    const A = normaliseItem('SHAKTI TAPE').key, B = normaliseItem('SAKTHI TAPE').key
    const c = checkItemRule({ kind: 'merge', keyA: A, keyB: B, canonical: 'SHAKTI TAPE' })
    if (!c.ok) throw new Error('x')
    const row: ItemRuleRow = { id: c.id, ...c.draft, createdAt: 't', updatedAt: '2026-10-11T10:00:00Z', deletedAt: null, branchId: 'b' }
    expect(groupItems([{ name: 'SHAKTI TAPE', count: 3 }, { name: 'SAKTHI TAPE', count: 2 }], [toGroupingRule(row)]).groups).toHaveLength(1)
    expect(groupItems([{ name: 'SHAKTI TAPE', count: 3 }, { name: 'SAKTHI TAPE', count: 2 }], [toGroupingRule({ ...row, deletedAt: 'd' })]).groups).toHaveLength(2)
  })
})
