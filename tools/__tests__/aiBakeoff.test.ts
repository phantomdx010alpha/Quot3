import { describe, expect, it } from 'vitest'
import { E5_SMALL, MINILM_L6 } from '../../src/shared/ai/modelConfig'
import { formatReport, looksLikeAmount, neighbours, pickSamples, readNames } from '../ai-bakeoff.mjs'

/** Tiny deterministic stand-in (Phase 223 adds the real FAKE embedder in src/main/ai): hashed character trigrams, 64 dims, L2-normalised. */
function fakeEmbed(texts: string[]): Promise<number[][]> {
  return Promise.resolve(texts.map((t) => {
    const s = ` ${t.toLowerCase().replace(/^(query|passage): /, '')} `
    const v = new Array<number>(64).fill(0)
    for (let i = 0; i + 3 <= s.length; i++) { let h = 7; for (const c of s.slice(i, i + 3)) h = (h * 31 + c.charCodeAt(0)) % 64; v[h]! += 1 }
    const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1
    return v.map((x) => x / n)
  }))
}

describe('ai-bakeoff tool (fixture, fake embedder, invented names)', () => {
  it('readNames trims, dedupes case-insensitively, drops blanks and amount-looking lines', () => {
    const r = readNames('Red Tomato\r\n\n red   tomato \nSugar\nRs. 450 sugar\nbolt 12.50\nsteel nail 2in\n')
    expect(r.names).toEqual(['Red Tomato', 'Sugar', 'steel nail 2in'])
    expect(r.skippedAmounts).toBe(2)
    expect(looksLikeAmount('tomato')).toBe(false)
    expect(looksLikeAmount('\u20b9500 tomato')).toBe(true)
  })
  it('pickSamples is deterministic, evenly spaced and capped', () => {
    const names = Array.from({ length: 10 }, (_, i) => `n${i}`)
    expect(pickSamples(names, 5)).toEqual(['n0', 'n2', 'n4', 'n6', 'n8'])
    expect(pickSamples(names, 5)).toEqual(pickSamples(names, 5))
    expect(pickSamples(names, 50)).toEqual(names)
    expect(pickSamples(names, 0)).toEqual([])
  })
  it('neighbours ranks the look-alike first, never returns the sample itself, honours k', async () => {
    const names = ['red tomato', 'tomato red', 'brown sugar', 'steel nail', 'sugar brown']
    const rows = await neighbours(E5_SMALL, fakeEmbed, names, ['red tomato', 'brown sugar'], 2)
    expect(rows[0]!.neighbours[0]!.name).toBe('tomato red')
    expect(rows[1]!.neighbours[0]!.name).toBe('sugar brown')
    for (const r of rows) { expect(r.neighbours.length).toBe(2); expect(r.neighbours.map((n) => n.name)).not.toContain(r.sample) }
  })
  it('report lists every model and sample with scores', async () => {
    const names = ['red tomato', 'tomato red', 'steel nail']
    const rows = await neighbours(MINILM_L6, fakeEmbed, names, ['red tomato'], 1)
    const text = formatReport([{ modelId: MINILM_L6.id, rows }])
    expect(text).toContain('=== all-MiniLM-L6-v2 ===')
    expect(text).toContain('red tomato')
    expect(text).toMatch(/\d\.\d{3}  tomato red/)
  })
})
