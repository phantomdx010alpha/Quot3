import { describe, it, expect } from 'vitest'
import {
  applyEdit, applyTextChange, clearFormat, concatRuns, fromPlain, isCanonical, length, normalize, plain, rangeState,
  resolveRange, runsEqual, setRedBold, sliceRuns, styleAt, toggleBold, toggleHighlight, toggleRed, RUN_FLAGS
} from '../runs'
import type { Runs } from '../../types'

const R = (...r: Runs): Runs => r

describe('basics and normalize', () => {
  it('plain / fromPlain / length', () => {
    expect(plain(R({ t: 'ab' }, { t: 'c', b: 1 }))).toBe('abc')
    expect(length(R({ t: 'ab' }, { t: 'c', b: 1 }))).toBe(3)
    expect(fromPlain('')).toEqual([])
    expect(fromPlain('x')).toEqual([{ t: 'x' }])
  })
  it('normalize drops empty runs, merges equal neighbours, canonicalises flags', () => {
    const n = normalize(R({ t: 'a' }, { t: '' }, { t: 'b' }, { t: 'c', b: 1 }, { t: 'd', b: 1 }, { t: 'e', b: 1, r: 1 }))
    expect(n).toEqual([{ t: 'ab' }, { t: 'cd', b: 1 }, { t: 'e', b: 1, r: 1 }])
    expect(normalize(R({ t: 'x', b: 0 as unknown as 1 }))).toEqual([{ t: 'x' }])
  })
  it('normalize is idempotent and does not mutate its input', () => {
    const input: Runs = [{ t: 'a' }, { t: 'b' }, { t: 'c', r: 1 }]
    const snapshot = JSON.stringify(input)
    const once = normalize(input)
    expect(JSON.stringify(input)).toBe(snapshot)
    expect(normalize(once)).toEqual(once)
    expect(isCanonical(once)).toBe(true)
    expect(isCanonical(input)).toBe(false)
  })
  it('runsEqual ignores run boundaries', () => {
    expect(runsEqual(R({ t: 'a' }, { t: 'b' }), R({ t: 'ab' }))).toBe(true)
    expect(runsEqual(R({ t: 'ab' }), R({ t: 'ab', b: 1 }))).toBe(false)
  })
})

describe('toggleBold', () => {
  const base = fromPlain('red tomato')
  it('partial selection → bold only there', () => {
    expect(toggleBold(base, 4, 10)).toEqual([{ t: 'red ' }, { t: 'tomato', b: 1 }])
  })
  it('whole selection already bold → removes it (and merges back)', () => {
    expect(toggleBold(toggleBold(base, 4, 10), 4, 10)).toEqual([{ t: 'red tomato' }])
  })
  it('mixed selection → becomes all bold (Excel rule)', () => {
    const mixed = toggleBold(base, 0, 3)
    expect(rangeState(mixed, 0, 10, 'b')).toBe('mixed')
    expect(toggleBold(mixed, 0, 10)).toEqual([{ t: 'red tomato', b: 1 }])
  })
  it('collapsed range = whole cell', () => {
    expect(toggleBold(base, 3, 3)).toEqual([{ t: 'red tomato', b: 1 }])
    expect(toggleBold(base, 0)).toEqual([{ t: 'red tomato', b: 1 }])
  })
  it('splits inside a run, keeps other flags, reversed range works', () => {
    const r = toggleBold(R({ t: 'abcdef', r: 1 }), 4, 2)
    expect(r).toEqual([{ t: 'ab', r: 1 }, { t: 'cd', r: 1, b: 1 }, { t: 'ef', r: 1 }])
  })
  it('empty cell is a no-op', () => {
    expect(toggleBold([], 0, 0)).toEqual([])
  })
})

describe('red, red+bold, highlight, clear', () => {
  it('setRedBold sets both in one call, second call clears both', () => {
    const a = setRedBold(fromPlain('hello world'), 6, 11)
    expect(a).toEqual([{ t: 'hello ' }, { t: 'world', b: 1, r: 1 }])
    expect(setRedBold(a, 6, 11)).toEqual([{ t: 'hello world' }])
  })
  it('setRedBold on a bold-only selection adds red (does not toggle bold off)', () => {
    const a = setRedBold(toggleBold(fromPlain('abc'), 0, 3), 0, 3)
    expect(a).toEqual([{ t: 'abc', b: 1, r: 1 }])
  })
  it('red and highlight toggle independently of bold', () => {
    let r = toggleBold(fromPlain('abcd'), 0, 2)
    r = toggleRed(r, 1, 3)
    r = toggleHighlight(r, 0, 4)
    expect(r).toEqual([{ t: 'a', b: 1, hl: 1 }, { t: 'b', b: 1, r: 1, hl: 1 }, { t: 'c', r: 1, hl: 1 }, { t: 'd', hl: 1 }])
  })
  it('clearFormat removes all flags in range, whole cell when collapsed', () => {
    const f = setRedBold(toggleHighlight(fromPlain('abcdef'), 0, 6), 2, 4)
    expect(clearFormat(f, 2, 4)).toEqual([{ t: 'ab', hl: 1 }, { t: 'cd' }, { t: 'ef', hl: 1 }])
    expect(clearFormat(f, 1)).toEqual([{ t: 'abcdef' }])
  })
  it('rangeState', () => {
    const r = toggleBold(fromPlain('abcd'), 0, 2)
    expect(rangeState(r, 0, 2, 'b')).toBe('all')
    expect(rangeState(r, 2, 4, 'b')).toBe('none')
    expect(rangeState(r, 1, 3, 'b')).toBe('mixed')
    expect(rangeState([], 0, 0, 'b')).toBe('empty')
  })
})

describe('applyEdit — style inheritance', () => {
  const r = R({ t: 'ab' }, { t: 'cd', b: 1 }, { t: 'ef', r: 1, b: 1 })
  it('insert takes the style of the char to the left', () => {
    expect(plain(applyEdit(r, { start: 2, text: 'X' }))).toBe('abXcdef')
    expect(applyEdit(r, { start: 2, text: 'X' })[0]).toEqual({ t: 'abX' })
    expect(applyEdit(r, { start: 4, text: 'Y' })[1]).toEqual({ t: 'cdY', b: 1 })
  })
  it('insert at 0 takes the style of the first char; insert into an empty cell is plain', () => {
    expect(applyEdit(R({ t: 'ab', b: 1 }), { start: 0, text: 'Z' })).toEqual([{ t: 'Zab', b: 1 }])
    expect(applyEdit([], { start: 0, text: 'Z' })).toEqual([{ t: 'Z' }])
  })
  it('replacement takes the first replaced char\'s style', () => {
    expect(applyEdit(r, { start: 2, end: 4, text: 'XY' })).toEqual([{ t: 'ab' }, { t: 'XY', b: 1 }, { t: 'ef', r: 1, b: 1 }])
  })
  it('pure delete keeps the rest styled, merges neighbours, may empty the cell', () => {
    expect(applyEdit(R({ t: 'a' }, { t: 'b', b: 1 }, { t: 'c' }), { start: 1, end: 2 })).toEqual([{ t: 'ac' }])
    expect(applyEdit(r, { start: 0, end: 6 })).toEqual([])
  })
  it('explicit style overrides inheritance (pending typing style)', () => {
    expect(applyEdit(fromPlain('ab'), { start: 2, text: 'X', style: { b: 1, r: 1 } })).toEqual([{ t: 'ab' }, { t: 'X', b: 1, r: 1 }])
    expect(applyEdit(R({ t: 'ab', b: 1 }), { start: 2, text: 'X', style: {} })).toEqual([{ t: 'ab', b: 1 }, { t: 'X' }])
  })
  it('out-of-range / reversed offsets are clamped; no-op edit returns equal runs', () => {
    expect(plain(applyEdit(fromPlain('abc'), { start: 99, text: 'Z' }))).toBe('abcZ')
    expect(plain(applyEdit(fromPlain('abc'), { start: -5, end: 1, text: '' }))).toBe('bc')
    expect(applyEdit(fromPlain('abc'), { start: 1 })).toEqual([{ t: 'abc' }])
  })
})

describe('applyTextChange (plain text known only)', () => {
  const base = R({ t: 'red ' }, { t: 'tomato', b: 1 })
  it('keeps styling of untouched text for mid-text edits', () => {
    expect(applyTextChange(base, 'red cherry tomato')).toEqual([{ t: 'red cherry ' }, { t: 'tomato', b: 1 }])
    expect(applyTextChange(base, 'red tomat')).toEqual([{ t: 'red ' }, { t: 'tomat', b: 1 }])
    expect(applyTextChange(base, 'XXd tomato')).toEqual([{ t: 'XXd ' }, { t: 'tomato', b: 1 }])
  })
  it('append continues the last style; empty clears; identical is unchanged', () => {
    expect(applyTextChange(base, 'red tomatoes')).toEqual([{ t: 'red ' }, { t: 'tomatoes', b: 1 }])
    expect(applyTextChange(base, '')).toEqual([])
    expect(applyTextChange(base, 'red tomato')).toEqual(base)
  })
  it('works from nothing', () => { expect(applyTextChange([], 'hi')).toEqual([{ t: 'hi' }]) })
})

describe('surrogate / Unicode safety', () => {
  const s = 'a😀b' // 😀 = 2 code units at offsets 1..3
  it('offsets inside a pair snap outward', () => {
    expect(resolveRange(fromPlain(s), 2, 2)).toEqual({ start: 1, end: 1 })
    expect(resolveRange(fromPlain(s), 2, 3)).toEqual({ start: 1, end: 3 })
    expect(resolveRange(fromPlain(s), 0, 2)).toEqual({ start: 0, end: 3 })
  })
  it('bold on half an emoji bolds the whole emoji, never splitting it', () => {
    const r = toggleBold(fromPlain(s), 2, 3)
    expect(r).toEqual([{ t: 'a' }, { t: '😀', b: 1 }, { t: 'b' }])
    expect(plain(r)).toBe(s)
  })
  it('insert/delete inside a pair never produces a lone surrogate', () => {
    const ins = plain(applyEdit(fromPlain(s), { start: 2, text: 'X' }))
    expect(ins).toBe('aX😀b')
    const del = plain(applyEdit(fromPlain(s), { start: 2, end: 3 }))
    expect(del).toBe('ab')
  })
  it('applyTextChange does not split a pair when a neighbouring emoji shares a high surrogate', () => {
    const out = applyTextChange(fromPlain('x😀'), 'x😁')
    expect(plain(out)).toBe('x😁')
    expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(plain(out))).toBe(false)
  })
  it('combining / Indic text keeps its code units untouched', () => {
    const t = 'க்ஷ e\u0301'
    expect(plain(toggleBold(fromPlain(t), 0, t.length))).toBe(t)
    expect(plain(applyEdit(fromPlain(t), { start: t.length, text: '!' }))).toBe(t + '!')
  })
})

describe('slice / concat / styleAt', () => {
  const r = R({ t: 'ab' }, { t: 'cd', b: 1 })
  it('sliceRuns and concatRuns round-trip', () => {
    expect(sliceRuns(r, 1, 3)).toEqual([{ t: 'b' }, { t: 'c', b: 1 }])
    expect(concatRuns(sliceRuns(r, 0, 2), sliceRuns(r, 2, 4))).toEqual(normalize(r))
  })
  it('styleAt', () => {
    expect(styleAt(r, 0)).toEqual({})
    expect(styleAt(r, 3)).toEqual({ b: 1 })
    expect(styleAt(r, 9)).toEqual({})
  })
})

// ---------- property tests: random operations against a per-code-unit reference model ----------
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
interface Cell { u: string; m: number }
const MASK = { b: 1, r: 2, hl: 4 } as const
const ALPHABET = ['a', 'b', 'c', ' ', '1', 'é', '😀', '😁', 'க', '\u0301']

function toModel(runs: Runs): Cell[] {
  const out: Cell[] = []
  for (const r of runs) {
    const m = (r.b ? 1 : 0) | (r.r ? 2 : 0) | (r.hl ? 4 : 0)
    for (const u of r.t) out.push({ u, m }) // iterates by code point; one Cell per code point
  }
  return out
}
const modelText = (m: Cell[]): string => m.map((c) => c.u).join('')
/** Offsets in the model are code-point indices; convert to code-unit offsets for the engine. */
const cuOffset = (m: Cell[], cp: number): number => { let n = 0; for (let i = 0; i < cp; i++) n += (m[i] as Cell).u.length; return n }

describe('property: random edits and formatting keep plain text, canonical form and model equality', () => {
  for (let seed = 1; seed <= 60; seed++) {
    it(`seed ${seed}`, () => {
      const rnd = prng(seed)
      const ri = (n: number): number => Math.floor(rnd() * n)
      let runs: Runs = []
      let model: Cell[] = []
      for (let step = 0; step < 80; step++) {
        const n = model.length
        const a = ri(n + 1), b = ri(n + 1)
        const lo = Math.min(a, b), hi = Math.max(a, b)
        const op = ri(8)
        if (op <= 2) { // insert / replace
          const text = Array.from({ length: 1 + ri(3) }, () => ALPHABET[ri(ALPHABET.length)] as string).join('')
          const del = ri(2) ? hi : lo
          const inherit = del > lo ? (model[lo] as Cell).m : lo > 0 ? (model[lo - 1] as Cell).m : n > 0 ? (model[0] as Cell).m : 0
          runs = applyEdit(runs, { start: cuOffset(model, lo), end: cuOffset(model, del), text })
          model = [...model.slice(0, lo), ...Array.from(text).map((u) => ({ u, m: inherit })), ...model.slice(del)]
        } else if (op === 3) { // delete
          runs = applyEdit(runs, { start: cuOffset(model, lo), end: cuOffset(model, hi) })
          model = [...model.slice(0, lo), ...model.slice(hi)]
        } else if (op <= 6) { // toggle b / r / hl / red+bold
          const which = ri(4)
          const mask = which === 0 ? 1 : which === 1 ? 2 : which === 2 ? 4 : 3
          const s = lo === hi ? 0 : lo, e = lo === hi ? n : hi
          const cells = model.slice(s, e)
          const allOn = cells.length > 0 && cells.every((c) => (c.m & mask) === mask)
          model = model.map((c, i) => (i >= s && i < e ? { u: c.u, m: allOn ? c.m & ~mask : c.m | mask } : c))
          const so = cuOffset(runs.length ? toModel(runs) : [], lo), eo = cuOffset(toModel(runs), hi)
          const fn = which === 0 ? toggleBold : which === 1 ? toggleRed : which === 2 ? toggleHighlight : setRedBold
          runs = fn(runs, so, eo)
        } else { // clear
          const s = lo === hi ? 0 : lo, e = lo === hi ? n : hi
          model = model.map((c, i) => (i >= s && i < e ? { u: c.u, m: 0 } : c))
          runs = clearFormat(runs, cuOffset(toModel(runs), lo), cuOffset(toModel(runs), hi))
        }
        // invariants after every step
        expect(plain(runs)).toBe(modelText(model))
        expect(isCanonical(runs)).toBe(true)
        expect(normalize(runs)).toEqual(runs)
        expect(toModel(runs).map((c) => c.m)).toEqual(model.map((c) => c.m))
        expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(plain(runs))).toBe(false)
      }
    })
  }
  it('applyTextChange: plain text always equals the target, result canonical, no lone surrogates', () => {
    const rnd = prng(999)
    const ri = (n: number): number => Math.floor(rnd() * n)
    const word = (): string => Array.from({ length: ri(8) }, () => ALPHABET[ri(ALPHABET.length)] as string).join('')
    let runs: Runs = []
    for (let i = 0; i < 300; i++) {
      if (ri(3) === 0 && length(runs) > 0) runs = toggleBold(runs, ri(length(runs)), ri(length(runs)))
      const target = word()
      runs = applyTextChange(runs, target)
      expect(plain(runs)).toBe(target)
      expect(isCanonical(runs)).toBe(true)
    }
  })
  it('RUN_FLAGS lists exactly the three flags', () => { expect([...RUN_FLAGS]).toEqual(['b', 'r', 'hl']); expect(Object.keys(MASK)).toEqual(['b', 'r', 'hl']) })
})
