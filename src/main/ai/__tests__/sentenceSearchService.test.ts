import { describe, expect, it } from 'vitest'
import { fakeVector } from '../fakeEmbedder'
import { createSentenceSearchService, similarityScore, type SentenceSearchDeps } from '../sentenceSearchService'
import type { EmbedOutcome } from '../../../shared/ai/aiStatus'
import { textKey } from '../../../shared/ai/textKey'

const BILLS: Record<string, { names: string[]; gst: boolean }> = {
  b1: { names: ['RUBY TOMATO'], gst: false },
  b2: { names: ['STEEL BOLT 505'], gst: true },
  b3: { names: ['STEEL BOLT D7'], gst: true }
}

function make(over: Partial<SentenceSearchDeps> = {}) {
  let outcome: EmbedOutcome | null = null
  const embedded: string[][] = []
  const stored = new Map<string, Float32Array>()
  for (const l of Object.values(BILLS)) for (const n of l.names) { const k = textKey(n); if (k) stored.set(k.hash, fakeVector(k.text)) }
  const deps: SentenceSearchDeps = {
    items: { billLines: (ids) => Object.fromEntries(ids.filter((i) => BILLS[i]).map((i) => [i, BILLS[i]!])) },
    ai: { embed: async (t): Promise<EmbedOutcome> => { embedded.push(t); return outcome ?? { ok: true, vectors: t.map((x) => fakeVector(x)) } }, cancel: () => 0 },
    vectors: { getMany: (_m, hashes) => hashes.filter((h) => stored.has(h)).map((h) => ({ hash: h, vector: stored.get(h)! })) },
    modelKey: 'fake@r1', threshold: 0.5, isEnabled: () => true, isRerankOn: () => true, ...over
  }
  return { svc: createSentenceSearchService(deps), embedded, fail: (o: EmbedOutcome) => { outcome = o } }
}

describe('sentenceSearchService (Phase 229)', () => {
  it('AI off: nothing is read and nothing is embedded', async () => {
    const m = make({ isEnabled: () => false })
    expect(await m.svc.searchSentence({ itemText: 'ruby tomato', billIds: ['b1'] })).toEqual({ scores: {}, formats: {}, embeddingsUsed: false })
    expect(m.embedded).toEqual([])
  })

  it('re-rank switch off: formats only, no model call', async () => {
    const m = make({ isRerankOn: () => false })
    const r = await m.svc.searchSentence({ itemText: 'ruby tomato', billIds: ['b1', 'b2', 'nope'] })
    expect(r).toEqual({ scores: {}, formats: { b1: 'nongst', b2: 'gst' }, embeddingsUsed: false })
    expect(m.embedded).toEqual([])
  })

  it('scores the similar bill (query embedding) and never a bill whose number or size conflicts', async () => {
    const m = make()
    const r = await m.svc.searchSentence({ itemText: 'ruby tomatoes', billIds: ['b1', 'b2'] })
    expect(r.embeddingsUsed).toBe(true)
    expect(r.scores.b1).toBeGreaterThan(0)
    expect(r.scores.b2).toBeUndefined()
    const bolt = await m.svc.searchSentence({ itemText: 'steel bolt 505', billIds: ['b2', 'b3'] })
    expect(bolt.scores.b2).toBeGreaterThan(0.9)
    expect(bolt.scores.b3).toBeUndefined() // "505" vs "D7" never matches
  })

  it('a missing or failing model still answers with the formats', async () => {
    const m = make()
    m.fail({ ok: false, reason: 'notInstalled' })
    expect(await m.svc.searchSentence({ itemText: 'ruby tomato', billIds: ['b1'] })).toEqual({ scores: {}, formats: { b1: 'nongst' }, embeddingsUsed: false })
    const t = make({ ai: { embed: async () => { throw new Error('boom') }, cancel: () => 0 } })
    expect((await t.svc.searchSentence({ itemText: 'ruby tomato', billIds: ['b1'] })).formats).toEqual({ b1: 'nongst' })
    const x = make({ items: { billLines: () => { throw new Error('db') } } })
    expect(await x.svc.searchSentence({ itemText: 'a b', billIds: ['b1'] })).toEqual({ scores: {}, formats: {}, embeddingsUsed: false })
  })

  it('similarityScore maps the threshold to a weak score and 1 to a full one', () => {
    expect(similarityScore(0.4, 0.5)).toBe(0)
    expect(similarityScore(0.5, 0.5)).toBeCloseTo(0.05)
    expect(similarityScore(1, 0.5)).toBe(1)
  })
})
