import type { Extractor } from './workerCore'

/**
 * Phase 223 (M22) - deterministic stand-in for the model (tests ONLY; never a real model, never the network).
 * Hashed character trigrams into `dim` buckets, L2-normalised, so similar strings get similar vectors and tests can assert ranking.
 * The e5 prefixes are ignored so a "query: x" and a "passage: x" of the same text match exactly.
 */
export function fakeVector(text: string, dim = 384): Float32Array {
  const s = ` ${text.toLowerCase().replace(/^(query|passage): /, '').replace(/\s+/g, ' ').trim()} `
  const v = new Float32Array(dim)
  for (let i = 0; i + 3 <= s.length; i++) {
    let h = 2166136261
    for (let j = 0; j < 3; j++) h = Math.imul(h ^ s.charCodeAt(i + j), 16777619)
    v[(h >>> 0) % dim]! += 1
  }
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n)
  if (n > 0) for (let i = 0; i < dim; i++) v[i]! /= n
  return v
}

export function createFakeEmbedder(dim = 384): Extractor {
  return async (texts) => texts.map((t) => fakeVector(t, dim))
}
