import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../canonicalJson'

describe('canonicalJson (Phase 53)', () => {
  it('sorts keys at every depth and writes no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 'x' } })).toBe('{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}')
  })
  it('is independent of insertion order', () => {
    expect(canonicalJson({ x: 1, y: 2, z: [{ q: 1, p: 2 }] })).toBe(canonicalJson({ z: [{ p: 2, q: 1 }], y: 2, x: 1 }))
  })
  it('drops undefined members, nulls undefined array slots, keeps null, normalises -0', () => {
    expect(canonicalJson({ a: undefined, b: null, c: [undefined, 1], d: -0 })).toBe('{"b":null,"c":[null,1],"d":0}')
  })
  it('keeps decimal strings exactly (money is never a number)', () => {
    expect(canonicalJson({ rate: '1250.50', qty: '90' })).toBe('{"qty":"90","rate":"1250.50"}')
  })
  it('escapes strings like JSON and keeps unicode intact', () => {
    expect(canonicalJson({ n: 'a"b\n\u20B9' })).toBe(JSON.stringify({ n: 'a"b\n\u20B9' }))
  })
  it('refuses what JSON cannot carry', () => {
    expect(() => canonicalJson({ a: NaN })).toThrow()
    expect(() => canonicalJson({ a: Infinity })).toThrow()
    expect(() => canonicalJson({ a: 1n })).toThrow()
    expect(() => canonicalJson({ a: () => 1 })).toThrow()
    expect(() => canonicalJson({ a: new Date() })).toThrow()
    const c: Record<string, unknown> = {}; c.self = c
    expect(() => canonicalJson(c)).toThrow()
  })
  it('allows the same object twice (not a cycle)', () => {
    const shared = { k: 1 }
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"k":1},"b":{"k":1}}')
  })
})
