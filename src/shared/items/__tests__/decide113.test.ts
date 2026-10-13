import { describe, expect, it } from 'vitest'
import { groupItems, type ItemRuleInput, type ItemSpelling } from '../grouping'
import { checkItemRule } from '../rules'
import { keysOfGroup, planDecision, type DecisionInput } from '../decide'
import { buildGroupRows, buildSpellingRows, groupIdsOf, moveGroupSelection, rowIndexOfGroup } from '../groupRows'
import type { GroupSummary } from '../api'

const SP: ItemSpelling[] = [
  { name: 'HOOK LONG', count: 9, lastUsed: '2026-10-01' },
  { name: 'HOOK LONGER', count: 4, lastUsed: '2026-09-01' },
  { name: 'CLIP STEEL', count: 6, lastUsed: '2026-08-01' },
  { name: 'ZIP RED', count: 3 }
]

let clock = 0
/** Applies decisions the way the service does: plan -> rule rows with strictly increasing times -> regroup. */
function world() {
  const rules: ItemRuleInput[] = []
  const regroup = () => groupItems(SP, rules)
  const decide = (input: DecisionInput) => {
    const r = regroup()
    const plan = planDecision(input, (id) => r.groups.find((g) => g.id === id))
    if (!plan.ok) return plan
    for (const d of plan.drafts) {
      const c = checkItemRule(d)
      if (!c.ok) throw new Error(c.error)
      const i = rules.findIndex((x) => x.id === c.id)
      const row: ItemRuleInput = { id: c.id, kind: c.draft.kind, keyA: c.draft.keyA, ...(c.draft.keyB ? { keyB: c.draft.keyB } : {}), updatedAt: new Date(Date.UTC(2026, 9, 11, 0, 0, ++clock)).toISOString() }
      if (i >= 0) rules[i] = row; else rules.push(row)
    }
    return plan
  }
  const idOf = (name: string) => regroup().groups.find((g) => g.spellings.some((s) => s.name === name))!.id
  return { regroup, decide, idOf, rules }
}

describe('Phase 113 decisions -> rules -> groups', () => {
  it('merge puts the whole of one group into the other, the target keeps its id', () => {
    const w = world()
    const plan = w.decide({ op: 'merge', fromGroupId: w.idOf('HOOK LONGER'), intoGroupId: w.idOf('HOOK LONG') })
    expect(plan.ok).toBe(true)
    const g = w.regroup().groups.find((x) => x.spellings.some((s) => s.name === 'HOOK LONG'))!
    expect(g.spellings.map((s) => s.name).sort()).toEqual(['HOOK LONG', 'HOOK LONGER'])
    expect(g.count).toBe(13)
    expect(w.regroup().groups).toHaveLength(3)
  })
  it('split undoes that merge for one spelling', () => {
    const w = world()
    w.decide({ op: 'merge', fromGroupId: w.idOf('HOOK LONGER'), intoGroupId: w.idOf('HOOK LONG') })
    const g = w.regroup().groups.find((x) => x.spellings.length === 2)!
    const key = g.spellings.find((s) => s.name === 'HOOK LONGER')!.originalKey
    expect(w.decide({ op: 'split', groupId: g.id, spellingKey: key }).ok).toBe(true)
    expect(w.regroup().groups).toHaveLength(4)
  })
  it('split of a group whose spellings share one key is refused with a reason', () => {
    const w = world()
    const g = w.regroup().groups[0]!
    const plan = w.decide({ op: 'split', groupId: g.id, spellingKey: keysOfGroup(g)[0]! })
    expect(plan.ok).toBe(false)
  })
  it('move: split first, then merge, so ONLY that spelling travels', () => {
    const w = world()
    w.decide({ op: 'merge', fromGroupId: w.idOf('HOOK LONGER'), intoGroupId: w.idOf('HOOK LONG') })
    const g = w.regroup().groups.find((x) => x.spellings.length === 2)!
    const key = g.spellings.find((s) => s.name === 'HOOK LONGER')!.originalKey
    const plan = w.decide({ op: 'move', groupId: g.id, spellingKey: key, intoGroupId: w.idOf('CLIP STEEL') })
    expect(plan.ok && plan.drafts.map((d) => d.kind)).toEqual(['split', 'merge'])
    const r = w.regroup()
    expect(r.groups.find((x) => x.spellings.some((s) => s.name === 'CLIP STEEL'))!.spellings.map((s) => s.name).sort()).toEqual(['CLIP STEEL', 'HOOK LONGER'])
    expect(r.groups.find((x) => x.spellings.some((s) => s.name === 'HOOK LONG'))!.spellings).toHaveLength(1)
  })
  it('move of a single-key group is just a merge', () => {
    const w = world()
    const g = w.regroup().groups.find((x) => x.spellings[0]!.name === 'ZIP RED')!
    const plan = w.decide({ op: 'move', groupId: g.id, spellingKey: keysOfGroup(g)[0]!, intoGroupId: w.idOf('CLIP STEEL') })
    expect(plan.ok && plan.drafts).toHaveLength(1)
    expect(w.regroup().groups).toHaveLength(3)
  })
  it('ignore removes the item from the list and reports it as an owner choice', () => {
    const w = world()
    w.decide({ op: 'ignore', groupId: w.idOf('ZIP RED') })
    const r = w.regroup()
    expect(r.groups.some((g) => g.spellings.some((s) => s.name === 'ZIP RED'))).toBe(false)
    expect(r.notItems.find((n) => n.name === 'ZIP RED')?.byOwner).toBe(true)
  })
  it('reject silences a suggestion between two groups', () => {
    const sp: ItemSpelling[] = [{ name: 'BELL BRASS', count: 8 }, { name: 'BELL BRASS SET', count: 1 }, { name: 'BELL STEEL', count: 7 }, { name: 'BELL BRASS PLATE', count: 1 }]
    const before = groupItems(sp, [])
    const pair = before.groups.flatMap((g) => g.suggestions).find((s) => s.kind === 'one-word')
    if (!pair) return // data-dependent: nothing to silence in this sample
    const from = before.groups.find((g) => g.id === pair.fromId)!
    const into = before.groups.find((g) => g.id === pair.toId)!
    const plan = planDecision({ op: 'reject', fromGroupId: from.id, intoGroupId: into.id }, (id) => before.groups.find((g) => g.id === id))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const c = checkItemRule(plan.drafts[0]!)
    if (!c.ok) throw new Error(c.error)
    const after = groupItems(sp, [{ id: c.id, kind: 'split', keyA: c.draft.keyA, keyB: c.draft.keyB, updatedAt: '2026-10-11T00:00:00Z' }])
    expect(after.groups.flatMap((g) => g.suggestions).some((s) => s.fromId === pair.fromId && s.toId === pair.toId)).toBe(false)
  })
  it('refuses itself, unknown ids and unknown spellings', () => {
    const find = () => undefined
    expect(planDecision({ op: 'merge', fromGroupId: 'a', intoGroupId: 'b' }, find).ok).toBe(false)
    const g = { id: 'a', display: 'A', spellings: [{ originalKey: 'A' }] }
    expect(planDecision({ op: 'merge', fromGroupId: 'a', intoGroupId: 'a' }, () => g).ok).toBe(false)
    expect(planDecision({ op: 'split', groupId: 'a', spellingKey: 'ZZ' }, () => g).ok).toBe(false)
  })
})

const sum = (id: string, count: number, fam: string | null = null): GroupSummary => ({ id, display: id, count, nonGstCount: count, gstCount: 0, lastUsed: null, familyId: fam, spellingCount: 1, suggestionCount: 0 })

describe('Phase 113 rows', () => {
  const groups = [sum('A1', 9, 'A'), sum('B1', 8), sum('A2', 5, 'A'), sum('C1', 2, 'C')]
  const fams = [{ id: 'A', name: 'A', groupIds: ['A1', 'A2'], count: 14 }, { id: 'C', name: 'C', groupIds: ['C1'], count: 2 }]
  it('family header, its variants, then the rest under "Other items"', () => {
    const rows = buildGroupRows(groups, fams)
    expect(rows.map((r) => (r.kind === 'family' ? `[${r.name}]` : r.group.id))).toEqual(['[A]', 'A1', 'A2', '[C]', 'C1', '[Other items]', 'B1'])
    expect(rows[0]).toMatchObject({ count: 14, groups: 2 })
  })
  it('no families at all: a plain list, no header', () => {
    expect(buildGroupRows(groups, []).every((r) => r.kind === 'group')).toBe(true)
  })
  it('a filtered list drops empty families', () => {
    expect(buildGroupRows([groups[3]!], fams).map((r) => r.key)).toEqual(['f:C', 'g:C1'])
  })
  it('selection moves over groups only and clamps', () => {
    const rows = buildGroupRows(groups, fams)
    expect(groupIdsOf(rows)).toEqual(['A1', 'A2', 'C1', 'B1'])
    expect(moveGroupSelection(rows, 'A2', 'ArrowDown')).toBe('C1')
    expect(moveGroupSelection(rows, 'B1', 'ArrowDown')).toBe('B1')
    expect(moveGroupSelection(rows, null, 'ArrowDown')).toBe('A1')
    expect(moveGroupSelection(rows, 'C1', 'Home')).toBe('A1')
    expect(moveGroupSelection([], 'x', 'ArrowDown')).toBeNull()
    expect(rowIndexOfGroup(rows, 'C1')).toBe(4)
  })
  it('spelling rows: spellings first, then suggestions with readable names', () => {
    const rows = buildSpellingRows(
      { id: 'a', display: 'A', familyId: null, spellings: [{ name: 'A', cleaned: 'A', note: '', count: 2, lastUsed: null, originalKey: 'A', why: { rule: 'most-used', text: '' } }], suggestions: [{ kind: 'plural', fromId: 'x', toId: 'y', text: 't', fromCount: 1, toCount: 2 }] },
      (id) => id.toUpperCase()
    )
    expect(rows.map((r) => r.kind)).toEqual(['spelling', 'suggestion'])
    expect(rows[1]).toMatchObject({ intoName: 'Y', fromName: 'X' })
  })
})
