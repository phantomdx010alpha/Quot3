import { describe, expect, it } from 'vitest'
import { cosine, dot, norm, normalise, topK } from '../vectorMath'

describe('vectorMath', () => {
  it('dot and norm', () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32)
    expect(norm([3, 4])).toBe(5)
    expect(dot(new Float32Array([1, 0]), [0, 1])).toBe(0)
  })
  it('different lengths throw', () => {
    expect(() => dot([1], [1, 2])).toThrow(RangeError)
    expect(() => cosine([1], [1, 2])).toThrow(RangeError)
  })
  it('normalise gives unit length and keeps a zero vector at zero (no NaN)', () => {
    const n = normalise([3, 4])
    expect(n).toBeInstanceOf(Float32Array)
    expect(norm(n)).toBeCloseTo(1, 6)
    expect(Array.from(normalise([0, 0, 0]))).toEqual([0, 0, 0])
  })
  it('cosine: same direction 1, orthogonal 0, opposite -1, zero vector 0, scale-free', () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1, 6)
    expect(cosine([1, 0], [0, 5])).toBe(0)
    expect(cosine([1, 1], [-1, -1])).toBeCloseTo(-1, 6)
    expect(cosine([0, 0], [1, 1])).toBe(0)
  })
  it('topK ranks best first, keeps input order on ties, honours k and minScore', () => {
    const items = [
      { id: 'a', v: [1, 0] },
      { id: 'b', v: [0.9, 0.1] },
      { id: 'c', v: [0, 1] },
      { id: 'd', v: [1, 0] }
    ]
    const r = topK([1, 0], items, (i) => i.v, 3)
    expect(r.map((x) => x.item.id)).toEqual(['a', 'd', 'b'])
    expect(r[0]!.index).toBe(0)
    expect(topK([1, 0], items, (i) => i.v, 10, 0.5).map((x) => x.item.id)).toEqual(['a', 'd', 'b'])
    expect(topK([1, 0], items, (i) => i.v, 0)).toEqual([])
    expect(topK([1, 0], [], (i: { v: number[] }) => i.v, 3)).toEqual([])
  })
})
