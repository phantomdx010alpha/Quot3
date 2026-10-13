import { describe, expect, it } from 'vitest'
import {
  chooseSurvivor, coreWords, fillBlanks, findPossibleDuplicates, mergeRecordId, oneLetterApart, pairKey, partyRecordId, planUnify, type DupParty
} from '../duplicates'
import { normalizePartyName } from '../../party/partyLite'

const P = (id: string, name: string, billCount = 0, createdAt = '2026-01-01T00:00:00.000Z', over: Partial<DupParty> = {}): DupParty =>
  ({ id, name, phone: '', address: '', transport: '', billCount, createdAt, ...over })

describe('record ids', () => {
  it('the same organisation and normalised name always give the same uuid-shaped id; another organisation or name differs', () => {
    const a = partyRecordId('org-1', normalizePartyName('SPACE  Garments'))
    expect(a).toBe(partyRecordId('org-1', normalizePartyName('space garments')))
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a).not.toBe(partyRecordId('org-2', 'space garments'))
    expect(a).not.toBe(partyRecordId('org-1', 'space garment'))
  })
  it('a merge record id depends on the pair in order; pairKey ignores order', () => {
    expect(mergeRecordId('a', 'b')).toBe(mergeRecordId('a', 'b'))
    expect(mergeRecordId('a', 'b')).not.toBe(mergeRecordId('b', 'a'))
    expect(pairKey('x', 'y')).toBe(pairKey('y', 'x'))
  })
})

describe('survivor and fields', () => {
  it('most bills wins; a tie goes to the older one; then the smaller id', () => {
    expect(chooseSurvivor(P('a', 'x', 1), P('b', 'x', 5)).survivor.id).toBe('b')
    expect(chooseSurvivor(P('a', 'x', 2, '2026-02-01T00:00:00.000Z'), P('b', 'x', 2, '2026-01-01T00:00:00.000Z')).survivor.id).toBe('b')
    expect(chooseSurvivor(P('b', 'x', 2), P('a', 'x', 2)).survivor.id).toBe('a')
    expect(chooseSurvivor(P('a', 'x', 2), P('b', 'x', 2)).survivor.id).toBe(chooseSurvivor(P('b', 'x', 2), P('a', 'x', 2)).survivor.id)
  })
  it('the survivor keeps its own phone / address / transport; only blanks are filled', () => {
    expect(fillBlanks({ phone: '111', address: '', transport: ' ' }, { phone: '222', address: 'Road 1', transport: 'VRL' })).toEqual({ phone: '111', address: 'Road 1', transport: 'VRL' })
  })
})

describe('planUnify (exact normalised names only)', () => {
  const corpus = [
    P('1', 'Space Garments', 3), P('2', 'SPACE  garments', 7), P('3', ' space garments ', 7, '2025-01-01T00:00:00.000Z'),
    P('4', 'Ruby Traders', 1), P('5', 'Ruby Traders Ltd', 1), P('6', 'Solo Co', 0)
  ]
  it('one survivor per equal-name group; similar names are left alone', () => {
    const plan = planUnify(corpus)
    expect(plan.groups).toBe(1)
    expect(plan.merges).toEqual([{ survivorId: '3', mergedId: '1' }, { survivorId: '3', mergedId: '2' }])
  })
  it('is idempotent: after the merges nothing is planned, and input order does not change the survivor', () => {
    const after = corpus.filter((p) => p.id !== '1' && p.id !== '2')
    expect(planUnify(after)).toEqual({ merges: [], groups: 0 })
    expect(planUnify([...corpus].reverse()).merges.map((m) => m.survivorId)).toEqual(['3', '3'])
  })
  it('counts only on a generated corpus', () => {
    const gen: DupParty[] = []
    for (let i = 0; i < 3000; i++) { gen.push(P(`a${i}`, `Customer ${i}`, i % 5)); if (i % 3 === 0) gen.push(P(`b${i}`, `CUSTOMER   ${i}`, (i + 1) % 5)) }
    const plan = planUnify(gen)
    expect(plan.groups).toBe(1000)
    expect(plan.merges).toHaveLength(1000)
    expect(new Set(plan.merges.map((m) => m.mergedId)).size).toBe(1000)
  })
})

describe('similar names are only suggested', () => {
  it('coreWords drops Ltd / Pvt style words and a plural s, keeps numbers', () => {
    expect(coreWords('M/s. Space Garments Pvt. Ltd.')).toEqual(['space', 'garment'])
    expect(coreWords('Unit 5 Traders')).toEqual(['unit', '5', 'trader'])
  })
  it('oneLetterApart', () => {
    expect(oneLetterApart('garments', 'garmentz')).toBe(true)
    expect(oneLetterApart('garments', 'garmentss')).toBe(true)
    expect(oneLetterApart('garments', 'garments')).toBe(false)
    expect(oneLetterApart('abcd', 'abce')).toBe(false) // too short
    expect(oneLetterApart('unit5aaa', 'unit6aaa')).toBe(false) // digits are protected
  })
  it('suggests Ltd / plural / one letter / starts-with, each with its rule and the survivor first', () => {
    const list = [
      P('1', 'Space Garment', 2), P('2', 'Space Garments Ltd', 9),
      P('3', 'Ruby Traders', 1), P('4', 'Ruby Tradars', 0),
      P('5', 'Zed Export House', 1), P('6', 'Zed Export', 4)
    ]
    const out = findPossibleDuplicates(list)
    expect(out.map((o) => [o.rule, o.survivorId, o.mergedId])).toEqual([
      ['same-core', '2', '1'], ['one-letter', '3', '4'], ['starts-with', '6', '5']
    ])
    expect(out.every((o) => o.reason.length > 10)).toBe(true)
  })
  it('exactly equal names are never listed (that is the unify), numbers and sizes are never fuzzy-merged', () => {
    expect(findPossibleDuplicates([P('1', 'Ruby Traders'), P('2', 'RUBY  traders')])).toEqual([])
    expect(findPossibleDuplicates([P('1', 'Unit 5 Traders'), P('2', 'Unit 6 Traders')])).toEqual([])
    expect(findPossibleDuplicates([P('1', 'Shirt 40 Co'), P('2', 'Shirt 42 Co')])).toEqual([])
    expect(findPossibleDuplicates([P('1', 'Space Garment 40'), P('2', 'Space Garments 40 Ltd')])).toHaveLength(1)
  })
  it('a pair marked "Not the same" is left out, in either order', () => {
    const list = [P('1', 'Space Garment'), P('2', 'Space Garments Ltd')]
    expect(findPossibleDuplicates(list, { notSame: new Set([pairKey('2', '1')]) })).toEqual([])
  })
  it('is deterministic whatever the input order, and a large corpus finishes quickly (counts only)', () => {
    const gen: DupParty[] = []
    for (let i = 0; i < 12000; i++) gen.push(P(`g${i}`, `Gen ${String.fromCharCode(97 + (i % 26))}${i} Traders`, i % 4, `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`))
    gen.push(P('x1', 'Genx Traders'), P('x2', 'Genx Trader Ltd'))
    const t0 = Date.now()
    const a = findPossibleDuplicates(gen)
    expect(Date.now() - t0).toBeLessThan(5000)
    const b = findPossibleDuplicates([...gen].reverse())
    expect(b).toEqual(a)
    expect(a.some((x) => x.rule === 'same-core' && [x.survivorId, x.mergedId].sort().join() === 'x1,x2')).toBe(true)
    expect(a.length).toBeLessThanOrEqual(200)
  })
})
