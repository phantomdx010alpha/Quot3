import { describe, expect, it } from 'vitest'
import { fakeVector } from '../fakeEmbedder'
import { createGroupSuggestService, type GroupSuggestDeps } from '../groupSuggestService'
import { textKey } from '../../../shared/ai/textKey'
import { normaliseItem } from '../../../shared/items/normalise'
import { keyPairId, pairKey, type GroupAiInput } from '../../../shared/ai/groupSuggest'

const grp = (id: string, name: string, count: number): GroupAiInput => ({ id, display: name, count, gstCount: 0, nonGstCount: count, spellings: [{ name, count, key: normaliseItem(name).key }] })
const GROUPS = [grp('RUBY TOMATO', 'RUBY TOMATO', 30), grp('RUBY TOMATOE', 'RUBY TOMATOE', 4), grp('ZEBRA PEN', 'ZEBRA PEN', 3)]

function make(over: Partial<GroupSuggestDeps> = {}, view: { ruleSuggested?: string[]; splitKeyPairs?: string[] } = {}, cached = true) {
  const stored = new Map<string, Float32Array>()
  if (cached) for (const g of GROUPS) { const k = textKey(g.display)!; stored.set(k.hash, fakeVector(k.text)) }
  let reads = 0
  const deps: GroupSuggestDeps = {
    items: { aiGroups: () => ({ groups: GROUPS, ruleSuggested: view.ruleSuggested ?? [], splitKeyPairs: view.splitKeyPairs ?? [] }) },
    vectors: { getMany: (_m, hashes) => { reads++; return hashes.filter((h) => stored.has(h)).map((h) => ({ hash: h, vector: stored.get(h)! })) } },
    modelKey: 'fake@r1', threshold: 0.5, isOn: () => true, ...over
  }
  return { svc: createGroupSuggestService(deps), reads: () => reads }
}

describe('groupSuggestService', () => {
  it('suggests from the cached vectors', () => {
    const r = make().svc.suggestGroups({ groupId: 'RUBY TOMATO' })
    expect(r.embeddingsUsed).toBe(true)
    expect(r.suggestions[0]).toMatchObject({ fromId: 'RUBY TOMATOE', toId: 'RUBY TOMATO' })
  })
  it('off (ai.enabled or ai.itemSuggestions) reads nothing and answers empty', () => {
    const m = make({ isOn: () => false })
    expect(m.svc.suggestGroups({ groupId: 'RUBY TOMATO' })).toEqual({ suggestions: [], embeddingsUsed: false })
    expect(m.reads()).toBe(0)
  })
  it('an empty cache (model not indexed yet) and an unknown group answer empty', () => {
    expect(make({}, {}, false).svc.suggestGroups({ groupId: 'RUBY TOMATO' }).suggestions).toEqual([])
    expect(make().svc.suggestGroups({ groupId: 'NOPE' }).suggestions).toEqual([])
  })
  it('honours rule-suggested and split pairs', () => {
    expect(make({}, { ruleSuggested: [pairKey('RUBY TOMATO', 'RUBY TOMATOE')] }).svc.suggestGroups({ groupId: 'RUBY TOMATO' }).suggestions).toEqual([])
    expect(make({}, { splitKeyPairs: [keyPairId(normaliseItem('RUBY TOMATO').key, normaliseItem('RUBY TOMATOE').key)] }).svc.suggestGroups({ groupId: 'RUBY TOMATO' }).suggestions).toEqual([])
  })
  it('never throws: a failing read gives an empty answer and logs once', () => {
    const logs: string[] = []
    const svc = createGroupSuggestService({ items: { aiGroups: () => { throw new Error('boom') } }, vectors: { getMany: () => [] }, modelKey: 'm', threshold: 0.5, isOn: () => true, log: (m) => logs.push(m) })
    expect(svc.suggestGroups({ groupId: 'x' })).toEqual({ suggestions: [], embeddingsUsed: false })
    svc.suggestGroups({ groupId: 'x' })
    expect(logs.length).toBe(1)
  })
})
