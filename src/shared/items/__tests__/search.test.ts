import { describe, expect, it } from 'vitest'
import type { GroupSummary } from '../api'
import { describeGroups, filterGroups, searchNeedle } from '../search'

const g = (id: string, display: string): GroupSummary => ({ id, display, count: 1, nonGstCount: 1, gstCount: 0, lastUsed: null, familyId: null, spellingCount: 1, suggestionCount: 0 })
const GROUPS = [g('a', 'AMETO SMALL'), g('b', 'AMETO BIG'), g('c', 'ARIHANT 32X50'), g('d', 'TALCO 2044')]

describe('Phase 112 items search', () => {
  it('normalises case, spaces and punctuation', () => {
    expect(searchNeedle('  ameto--small ')).toBe('AMETO SMALL')
    expect(searchNeedle('')).toBe('')
  })
  it('empty query returns the same array', () => {
    expect(filterGroups(GROUPS, '')).toBe(GROUPS)
    expect(filterGroups(GROUPS, '  ')).toBe(GROUPS)
  })
  it('every word must match, in any order', () => {
    expect(filterGroups(GROUPS, 'small ameto').map((x) => x.id)).toEqual(['a'])
    expect(filterGroups(GROUPS, 'ameto').map((x) => x.id)).toEqual(['a', 'b'])
    expect(filterGroups(GROUPS, 'zzz')).toEqual([])
  })
  it('sizes are matched as typed, never fuzzily', () => {
    expect(filterGroups(GROUPS, '32x50').map((x) => x.id)).toEqual(['c'])
    expect(filterGroups(GROUPS, '25x50')).toEqual([])
  })
  it('describes the counts', () => {
    expect(describeGroups(0, 0)).toBe('No items yet')
    expect(describeGroups(1, 1)).toBe('1 item')
    expect(describeGroups(3, 3)).toBe('3 items')
    expect(describeGroups(2, 10)).toBe('2 of 10 items')
  })
})
