import { describe, expect, it } from 'vitest'
import { fakeVector } from '../fakeEmbedder'
import { createSuggestService, toHistoryLine, type SuggestDeps } from '../suggestService'
import type { SaleLine } from '../../../shared/items/sales'
import type { EmbedOutcome } from '../../../shared/ai/aiStatus'
import { textKey } from '../../../shared/ai/textKey'

const sale = (name: string, date: string, rate: string | null, gst = false): SaleLine => ({
  billId: `b-${name}-${date}`, rowIdx: 0, poNumber: '1', billDate: date, createdAt: `${date}T00:00:00Z`, partyKey: 'id:p1', partyName: 'Sharma',
  name, qty: '5', rate, gst, gstPct: null, lineTotal: null, gstAmt: null, amount: null
})

function make(over: Partial<SuggestDeps> = {}, lines: SaleLine[] = [sale('RUBY TOMATO', '2026-01-05', '40'), sale('STEEL BOLT', '2026-01-04', '3', true)]) {
  const asked: string[] = []
  let outcome: EmbedOutcome = { ok: true, vectors: [] }
  const embedCalls: string[][] = []
  const stored = new Map<string, Float32Array>()
  for (const l of lines) { const k = textKey(l.name); if (k) stored.set(k.hash, fakeVector(k.text)) }
  const deps: SuggestDeps = {
    items: { partyHistory: (k) => { asked.push(k); return { lines, groupIdOf: () => null } } },
    ai: { embed: async (t): Promise<EmbedOutcome> => { embedCalls.push(t); return outcome.ok ? { ok: true, vectors: t.map((x) => fakeVector(x)) } : outcome }, cancel: () => 0 },
    vectors: { getMany: (_m, hashes) => hashes.filter((h) => stored.has(h)).map((h) => ({ hash: h, vector: stored.get(h)! })) },
    modelKey: 'fake@r1', threshold: 0.5, isEnabled: () => true, ...over
  }
  return { svc: createSuggestService(deps), asked, embedCalls, fail: (o: EmbedOutcome) => { outcome = o } }
}

describe('suggestService', () => {
  it('uses the party key (id first, name otherwise) and returns tier 2 with the model on', async () => {
    const m = make()
    const r = await m.svc.suggestForParty({ partyId: 'p1', partyName: 'Sharma', text: 'ruby tom' })
    expect(m.asked).toEqual(['id:p1'])
    expect(r.embeddingsUsed).toBe(true)
    expect(r.suggestions[0]).toMatchObject({ nameUsed: 'RUBY TOMATO', tier: 2, formatLabel: 'Non-GST' })
    await m.svc.suggestForParty({ partyId: null, partyName: ' sharma  ', text: 'ruby' })
    expect(m.asked[1]).toBe('name:SHARMA')
  })

  it('tier 3 comes from cached vectors (typed text embedded as a query)', async () => {
    const m = make({}, [sale('TOMATO RUBY', '2026-01-05', '40')])
    const r = await m.svc.suggestForParty({ partyId: 'p1', partyName: 'S', text: 'rubi tomatoo' })
    expect(m.embedCalls[0]).toEqual(['rubi tomatoo'])
    expect(r.suggestions[0]).toMatchObject({ nameUsed: 'TOMATO RUBY', tier: 3 })
  })

  it('model off, missing or failing: tier 1-2 only, embeddingsUsed false, never throws', async () => {
    const off = make({ isEnabled: () => false })
    expect((await off.svc.suggestForParty({ partyId: 'p1', partyName: 'S', text: 'ruby tom' })).embeddingsUsed).toBe(false)
    expect(off.embedCalls).toEqual([])
    const bad = make()
    bad.fail({ ok: false, reason: 'notInstalled' })
    const r = await bad.svc.suggestForParty({ partyId: 'p1', partyName: 'S', text: 'ruby tom' })
    expect(r).toMatchObject({ embeddingsUsed: false })
    expect(r.suggestions).toHaveLength(1)
    const boom = make({ ai: { embed: async () => { throw new Error('x') }, cancel: () => 0 } })
    expect((await boom.svc.suggestForParty({ partyId: 'p1', partyName: 'S', text: 'ruby tom' })).suggestions).toHaveLength(1)
    const broken = make({ items: { partyHistory: () => { throw new Error('db') } } })
    expect(await broken.svc.suggestForParty({ partyId: 'p1', partyName: 'S', text: 'ruby tom' })).toEqual({ suggestions: [], embeddingsUsed: false })
  })

  it('no party or no text answers empty without touching anything', async () => {
    const m = make()
    expect((await m.svc.suggestForParty({ partyId: null, partyName: '', text: 'ruby' })).suggestions).toEqual([])
    expect((await m.svc.suggestForParty({ partyId: 'p1', partyName: 'S', text: '  ' })).suggestions).toEqual([])
    expect(m.asked).toEqual([])
  })

  it('toHistoryLine labels GST by the bill format flag', () => {
    expect(toHistoryLine(sale('A', '2026-01-01', '1', true)).formatLabel).toBe('GST')
    expect(toHistoryLine(sale('A', '2026-01-01', '1')).formatLabel).toBe('Non-GST')
  })
})
