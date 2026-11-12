/** Phase 222 (M22) - vector maths for the embedding features (pure, no deps). Vectors are Float32Array or number[]. */
export type Vec = ArrayLike<number>

function sameLength(a: Vec, b: Vec): void {
  if (a.length !== b.length) throw new RangeError(`vector length mismatch: ${a.length} vs ${b.length}`)
}

export function dot(a: Vec, b: Vec): number {
  sameLength(a, b)
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!
  return s
}

export const norm = (a: Vec): number => Math.sqrt(dot(a, a))

/** L2-normalised copy. A zero vector stays all zeros (never NaN). */
export function normalise(a: Vec): Float32Array {
  const n = norm(a)
  const out = new Float32Array(a.length)
  if (n === 0) return out
  for (let i = 0; i < a.length; i++) out[i] = a[i]! / n
  return out
}

/** Cosine similarity in [-1, 1]; 0 when either vector is all zeros. */
export function cosine(a: Vec, b: Vec): number {
  sameLength(a, b)
  const na = norm(a)
  const nb = norm(b)
  if (na === 0 || nb === 0) return 0
  return dot(a, b) / (na * nb)
}

export interface Scored<T> { item: T; score: number; index: number }

/**
 * The K items most similar to `query` (cosine), best first. Ties keep the input order. `minScore` drops weaker ones.
 * `getVector` lets callers rank any shape of item.
 */
export function topK<T>(query: Vec, items: readonly T[], getVector: (item: T) => Vec, k: number, minScore = -Infinity): Scored<T>[] {
  if (!(k > 0)) return []
  const scored: Scored<T>[] = []
  items.forEach((item, index) => {
    const score = cosine(query, getVector(item))
    if (score >= minScore) scored.push({ item, score, index })
  })
  scored.sort((x, y) => y.score - x.score || x.index - y.index)
  return scored.slice(0, Math.floor(k))
}
