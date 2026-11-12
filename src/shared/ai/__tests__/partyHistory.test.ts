import { describe, expect, it } from 'vitest'
import { fakeVector } from '../../../main/ai/fakeEmbedder'
import { explainSuggestion, nearTextScore, protectedConflict, suggestFromHistory, type HistoryLine } from '../partyHistory'

// Invented fixtures only.
let n = 0
const L = (name: string, date: string, rate: string | null, gst = false, qty: string | null = '10'): HistoryLine =>
  ({ billId: `b${++n}`, name, qty, unit: null, rate, billDate: date, createdAt: `${date}T10:00:00Z`, gst, formatLabel: gst ? 'GST' : 'Non-GST' })
const noGroup = (): string | null => null
const base = { groupIdOf: noGroup, threshold: 0.6 }

describe('partyHistory', () => {
  it('tier 1: same group (owner rule / Items-page group), even with different words', () => {
    const groups: Record<string, string> = { 'RUBY TOMATO': 'g1', 'LAL TAMATAR': 'g1', 'ONION': 'g2' }
    const r = suggestFromHistory({ typed: 'Ruby Tomato', lines: [L('LAL TAMATAR', '2026-01-05', '40'), L('ONION', '2026-01-06', '20')], groupIdOf: (x) => groups[x.toUpperCase()] ?? null, threshold: 0.6 })
    expect(r.suggestions).toHaveLength(1)
    expect(r.suggestions[0]).toMatchObject({ nameUsed: 'LAL TAMATAR', tier: 1, why: 'same group', lastRate: '40', timesBought: 1 })
  })

  it('tier 2: typed words are the start of old words; one safe typo allowed', () => {
    const r = suggestFromHistory({ ...base, typed: 'ruby tom', lines: [L('RUBY TOMATO', '2026-01-05', '40'), L('BLUE PEN', '2026-01-04', '5')] })
    expect(r.suggestions.map((s) => s.nameUsed)).toEqual(['RUBY TOMATO'])
    expect(r.suggestions[0]!.tier).toBe(2)
    const t = suggestFromHistory({ ...base, typed: 'tomatoe', lines: [L('TOMATO', '2026-01-05', '40')] })
    expect(t.suggestions).toHaveLength(1)
    expect(nearTextScore(['pen'], ['blue', 'pen'])).not.toBeNull()
    expect(nearTextScore(['zzz'], ['blue', 'pen'])).toBeNull()
  })

  it('tier 3: similar by vector above the threshold; embeddingsUsed true', () => {
    const lines = [L('TOMATO RUBY', '2026-01-05', '40'), L('STEEL BOLT', '2026-01-04', '3')]
    const r = suggestFromHistory({ ...base, typed: 'ruby tomatto', lines, typedVector: fakeVector('ruby tomatto'), vectorOf: (nm) => fakeVector(nm.toLowerCase()), threshold: 0.5 })
    expect(r.embeddingsUsed).toBe(true)
    expect(r.suggestions.map((s) => s.nameUsed)).toContain('TOMATO RUBY')
    expect(r.suggestions.find((s) => s.nameUsed === 'STEEL BOLT')).toBeUndefined()
    const off = suggestFromHistory({ ...base, typed: 'ruby tomatto', lines })
    expect(off.embeddingsUsed).toBe(false)
  })

  it('conflicting numbers are rejected in every tier (505 vs D7)', () => {
    const lines = [L('HINGE D7', '2026-01-05', '9'), L('HINGE 505', '2026-01-04', '8')]
    const groups: Record<string, string> = { 'HINGE 505': 'g', 'HINGE D7': 'g' }
    const r = suggestFromHistory({ typed: 'hinge 505', lines, groupIdOf: (x) => groups[x.toUpperCase()] ?? null, threshold: 0, typedVector: fakeVector('hinge 505'), vectorOf: (x) => fakeVector(x.toLowerCase()) })
    expect(r.suggestions.map((s) => s.nameUsed)).toEqual(['HINGE 505'])
    expect(protectedConflict(['505'], ['D7'])).toBe(true)
    expect(protectedConflict([], ['D7'])).toBe(false)
  })

  it('unit / size mismatch is rejected', () => {
    const r = suggestFromHistory({ ...base, typed: 'wire 10 kg', lines: [L('WIRE 10 MTR', '2026-01-05', '9'), L('WIRE 32X50', '2026-01-05', '9'), L('WIRE 10 KG', '2026-01-01', '8')] })
    expect(r.suggestions.map((s) => s.nameUsed)).toEqual(['WIRE 10 KG'])
  })

  it('GST and Non-GST stay separate; same name + format collapses with a count and the newest rate', () => {
    const lines = [L('PEN BLUE', '2026-01-01', '5'), L('PEN BLUE', '2026-03-01', '6'), L('pen  blue', '2026-02-01', '5.5'), L('PEN BLUE', '2026-02-15', '7', true)]
    const r = suggestFromHistory({ ...base, typed: 'pen blue', lines })
    expect(r.suggestions).toHaveLength(2)
    const non = r.suggestions.find((s) => !s.gst)!
    expect(non).toMatchObject({ formatLabel: 'Non-GST', timesBought: 3, lastRate: '6', lastDate: '2026-03-01' })
    expect(r.suggestions.find((s) => s.gst)).toMatchObject({ formatLabel: 'GST', timesBought: 1, lastRate: '7' })
  })

  it('ranks by tier, then score, then recency; max 5; a blank latest rate falls back to the last priced one', () => {
    const groups: Record<string, string> = { 'ALPHA': 'g', 'ALFA': 'g' }
    const lines = [L('ALPHA X', '2026-01-01', '1'), L('ALPHA XY', '2026-05-01', '2'), L('ALFA', '2026-02-01', '3')]
    const r = suggestFromHistory({ typed: 'alpha', lines, groupIdOf: (x) => groups[x.toUpperCase()] ?? null, threshold: 1 })
    expect(r.suggestions[0]!.nameUsed).toBe('ALFA') // tier 1 first
    const many = Array.from({ length: 9 }, (_, i) => L(`BOLT ${i}`, `2026-01-0${i + 1}`, '1'))
    expect(suggestFromHistory({ ...base, typed: 'bolt', lines: many }).suggestions).toHaveLength(5)
    const fb = suggestFromHistory({ ...base, typed: 'nut', lines: [L('NUT', '2026-01-01', '4'), L('NUT', '2026-02-01', null)] })
    expect(fb.suggestions[0]).toMatchObject({ lastRate: '4', timesBought: 2, lastDate: '2026-02-01' })
  })

  it('empty history, empty / one-letter / non-goods typed text give nothing', () => {
    expect(suggestFromHistory({ ...base, typed: 'pen', lines: [] }).suggestions).toEqual([])
    expect(suggestFromHistory({ ...base, typed: '', lines: [L('PEN', '2026-01-01', '1')] }).suggestions).toEqual([])
    expect(suggestFromHistory({ ...base, typed: 'p', lines: [L('PEN', '2026-01-01', '1')] }).suggestions).toEqual([])
    expect(suggestFromHistory({ ...base, typed: 'Coolie', lines: [L('COOLIE', '2026-01-01', '1')] }).suggestions).toEqual([])
  })

  it('explanation is plain text with the reason, count, rate and date', () => {
    const r = suggestFromHistory({ ...base, typed: 'pen', lines: [L('PEN BLUE', '2026-01-01', '5'), L('PEN BLUE', '2026-01-09', '6')] })
    expect(r.suggestions[0]!.explanation).toBe(explainSuggestion(r.suggestions[0]!))
    expect(r.suggestions[0]!.explanation).toContain('Bought 2 times')
    expect(r.suggestions[0]!.explanation).toContain('last rate 6')
  })
})
