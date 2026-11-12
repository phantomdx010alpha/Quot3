import { describe, expect, it } from 'vitest'
import { fakeVector } from '../../../main/ai/fakeEmbedder'
import { gstCompatible, gstKind, groupVector, keyPairId, pairKey, protectedMismatch, suggestGroupMerges, type GroupAiInput } from '../groupSuggest'
import { normaliseItem } from '../../items/normalise'

const g = (id: string, names: Array<[string, number]>, gst = 0, non = 1): GroupAiInput => ({
  id, display: names[0]![0], count: names.reduce((n, x) => n + x[1], 0), gstCount: gst, nonGstCount: non,
  spellings: names.map(([name, count]) => ({ name, count, key: normaliseItem(name).key }))
})
const vec = (name: string): Float32Array => fakeVector(name)
// 0.5: the fake embedder is trigram based, so near spellings score well above it
const base = { vectorOf: vec, threshold: 0.5 }

describe('groupSuggest (Phase 227)', () => {
  const groups = [
    g('RUBY TOMATO', [['RUBY TOMATO', 30]]),
    g('RUBY TOMATOE', [['RUBY TOMATOE', 4], ['RUBI TOMATO', 2]]),
    g('MILTON 505', [['MILTON 505', 9]]),
    g('MILTON D7', [['MILTON D7', 5]]),
    g('AMETO SMALL', [['AMETO SMALL', 8]]),
    g('AMETO BIG', [['AMETO BIG', 6]]),
    g('ZEBRA PEN', [['ZEBRA PEN', 3]])
  ]

  it('proposes the near group, the less used side merges into the more used one, with a reason', () => {
    const r = suggestGroupMerges({ ...base, groupId: 'RUBY TOMATO', groups })
    expect(r.length).toBeGreaterThan(0)
    expect(r[0]).toMatchObject({ fromId: 'RUBY TOMATOE', toId: 'RUBY TOMATO', why: 'looks similar' })
    expect(r[0]!.explanation).toContain('Reads like the same item')
    // asking from the other side gives the same pair and direction
    const back = suggestGroupMerges({ ...base, groupId: 'RUBY TOMATOE', groups })
    expect(back[0]).toMatchObject({ fromId: 'RUBY TOMATOE', toId: 'RUBY TOMATO', pairKey: r[0]!.pairKey })
  })

  it('never merges different numbers, sizes or units, nor BIG with SMALL', () => {
    const a = suggestGroupMerges({ ...base, threshold: 0, groupId: 'MILTON 505', groups })
    expect(a.find((s) => s.fromId === 'MILTON D7' || s.toId === 'MILTON D7')).toBeUndefined()
    const b = suggestGroupMerges({ ...base, threshold: 0, groupId: 'AMETO SMALL', groups })
    expect(b.find((s) => s.fromId === 'AMETO BIG' || s.toId === 'AMETO BIG')).toBeUndefined()
    expect(protectedMismatch('ARIHANT 10 KG', 'ARIHANT 10 MTR')).toBe(true)
    expect(protectedMismatch('ARIHANT 32X50', 'ARIHANT 25X50')).toBe(true)
    expect(protectedMismatch('TALCO 2044 RED', 'TALCO 2044 BLUE')).toBe(true)
    expect(protectedMismatch('TALCO 2044 RED', 'TALCO 2044')).toBe(true)
    expect(protectedMismatch('RUBY TOMATO', 'RUBY TOMATOE')).toBe(false)
  })

  it('never puts a pure GST group with a pure Non-GST group', () => {
    const gs = [g('RUBY TOMATO', [['RUBY TOMATO', 30]], 0, 30), g('RUBY TOMATOE', [['RUBY TOMATOE', 4]], 4, 0)]
    expect(suggestGroupMerges({ ...base, groupId: 'RUBY TOMATO', groups: gs })).toEqual([])
    const same = [g('RUBY TOMATO', [['RUBY TOMATO', 30]], 30, 0), g('RUBY TOMATOE', [['RUBY TOMATOE', 4]], 4, 0)]
    expect(suggestGroupMerges({ ...base, groupId: 'RUBY TOMATO', groups: same }).length).toBe(1)
    expect(gstKind({ gstCount: 2, nonGstCount: 0 })).toBe('gst')
    expect(gstKind({ gstCount: 2, nonGstCount: 1 })).toBe('mixed')
    expect(gstCompatible({ gstCount: 2, nonGstCount: 1 }, { gstCount: 0, nonGstCount: 5 })).toBe(true)
  })

  it('skips dismissed pairs, pairs the rules already suggest and pairs the owner split', () => {
    const key = pairKey('RUBY TOMATO', 'RUBY TOMATOE')
    expect(suggestGroupMerges({ ...base, groupId: 'RUBY TOMATO', groups, dismissed: new Set([key]) })).toEqual([])
    expect(suggestGroupMerges({ ...base, groupId: 'RUBY TOMATO', groups, ruleSuggested: new Set([key]) })).toEqual([])
    const split = new Set([keyPairId(normaliseItem('RUBI TOMATO').key, normaliseItem('RUBY TOMATO').key)])
    expect(suggestGroupMerges({ ...base, groupId: 'RUBY TOMATO', groups, splitKeyPairs: split })).toEqual([])
  })

  it('handles no vectors, an unknown group, the threshold and the cap without throwing', () => {
    expect(suggestGroupMerges({ ...base, groupId: 'RUBY TOMATO', groups, vectorOf: () => null })).toEqual([])
    expect(suggestGroupMerges({ ...base, groupId: 'NOPE', groups })).toEqual([])
    expect(suggestGroupMerges({ ...base, threshold: 0.9999, groupId: 'RUBY TOMATO', groups })).toEqual([])
    expect(suggestGroupMerges({ ...base, threshold: -1, groupId: 'RUBY TOMATO', groups, max: 2 }).length).toBeLessThanOrEqual(2)
  })

  it('a group is the count-weighted average of the spelling vectors that exist', () => {
    const gr = g('X', [['RUBY TOMATO', 3], ['NO VECTOR', 1]])
    const v = groupVector(gr, (n) => (n === 'NO VECTOR' ? null : vec(n)))!
    expect(v.length).toBe(384)
    expect(Math.abs(Math.hypot(...v) - 1)).toBeLessThan(1e-5)
    expect(groupVector(gr, () => null)).toBeNull()
  })
})
