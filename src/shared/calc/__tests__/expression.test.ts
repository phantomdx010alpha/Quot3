import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Decimal from 'decimal.js'
import { evaluateExpression, CALC_MAX_INPUT } from '../expression'
import { DEFAULT_PERCENT_PRESETS, parsePercent, percentResults, readPercentPresets, validatePercentPresets } from '../percentPresets'

const val = (s: string): string => { const r = evaluateExpression(s); if (!r.ok) throw new Error(`${s}: ${r.error}`); return r.value }
const err = (s: string): string => { const r = evaluateExpression(s); if (r.ok) throw new Error(`${s} should fail, gave ${r.value}`); return r.error }

describe('Phase 82 - expression engine: table', () => {
  const table: Array<[string, string]> = [
    ['1+2', '3'], ['1 + 2 * 3', '7'], ['(1+2)*3', '9'], ['10-4-3', '3'], ['100/4/5', '5'], ['2*3+4*5', '26'],
    ['-5+2', '-3'], ['--5', '5'], ['-(2+3)', '-5'], ['+7', '7'], ['2*-3', '-6'], ['2--3', '5'],
    ['1.5+2.25', '3.75'], ['.5+.5', '1'], ['5.+1', '6'], ['0.1+0.2', '0.3'],
    ['1,000+2,500', '3500'], ['1,00,000*2', '200000'], [' 12 + 3 ', '15'],
    ['6x7', '42'], ['6X7', '42'], ['6\u00D77', '42'], ['84\u00F72', '42'], ['9\u22123', '6'],
    ['200+10%', '220'], ['200-10%', '180'], ['200*10%', '20'], ['10%', '0.1'], ['50%', '0.5'], ['200/50%', '400'],
    ['100+10%+10%', '121'], ['100+2*10%', '100.2'], ['(100+10)%', '1.1'], ['10%%', '0.001'], ['100+(5)%', '105'],
    ['1000+18%', '1180'], ['1180-18%', '967.6'], ['0-0', '0'], ['0*5', '0'], ['-0', '0']
  ]
  for (const [src, want] of table) it(`${src} = ${want}`, () => expect(val(src)).toBe(want))

  it('x is multiplication, so 0x10 is 0 * 10; 1/3*3 keeps full precision in value and shows 1', () => {
    expect(val('0x10')).toBe('0')
    const r = evaluateExpression('1/3*3')
    expect(r.ok && r.value).toBe('0.9999999999999999999999999999')
    expect(r.ok && r.text).toBe('1')
  })

  it('result text is trimmed to 10 dp, the value keeps full precision', () => {
    const r = evaluateExpression('1/3')
    expect(r.ok && r.text).toBe('0.3333333333')
    expect(r.ok && r.value.length).toBeGreaterThan(15)
    expect(val('2/3')).toBe('0.6666666666666666666666666667')
  })
})

describe('Phase 82 - expression engine: errors never throw, never NaN', () => {
  it('malformed input', () => {
    for (const s of ['', '   ', '+', '1+', '*2', '(1+2', '1+2)', '()', '1..2', '1.2.3', '.', '1 2', '1++', '2**3', 'abc', '1+a', '5 % 5', '%', '1;2', '1e5']) {
      const r = evaluateExpression(s)
      expect(r.ok, s).toBe(false)
      if (!r.ok) { expect(r.error).not.toBe(''); expect(r.pos).toBeGreaterThanOrEqual(0) }
    }
  })
  it('divide by zero (also via a zero sub-expression or 0%)', () => {
    expect(err('1/0')).toMatch(/zero/i)
    expect(err('5/(2-2)')).toMatch(/zero/i)
    expect(err('5/0%')).toMatch(/zero/i)
    expect(err('0/0')).toMatch(/zero/i)
  })
  it('absurd size: too long, too deep, too large', () => {
    expect(evaluateExpression('1+'.repeat(CALC_MAX_INPUT)).ok).toBe(false)
    expect(err('('.repeat(60) + '1' + ')'.repeat(60))).toMatch(/nested/i)
    expect(err('9'.repeat(25))).toMatch(/large/i)
    expect(err('999999999999*999999999999*999999999999')).toMatch(/large/i)
    expect(err('1'.repeat(31))).toMatch(/long/i)
  })
  it('non-string input is an error, not a throw', () => {
    expect(evaluateExpression(undefined as never).ok).toBe(false)
    expect(evaluateExpression(5 as never).ok).toBe(false)
  })
  it('the error position points into the text', () => {
    const r = evaluateExpression('12+ab')
    expect(!r.ok && r.pos).toBe(3)
  })
})

describe('Phase 82 - property: results equal a decimal.js reference', () => {
  // small deterministic LCG so the run is repeatable
  let seed = 82
  const rnd = (n: number): number => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % n }
  const num = (): string => `${rnd(1000)}${rnd(2) ? '.' + String(rnd(100)).padStart(2, '0') : ''}`
  const D = Decimal.clone({ precision: 28, rounding: Decimal.ROUND_HALF_UP })
  it('random + - * expressions with parentheses (no % and no division)', () => {
    for (let i = 0; i < 300; i++) {
      const a = num(), b = num(), c = num(), d = num()
      const ops = ['+', '-', '*']
      const o1 = ops[rnd(3)]!, o2 = ops[rnd(3)]!, o3 = ops[rnd(3)]!
      const src = `(${a} ${o1} ${b}) ${o2} ${c} ${o3} ${d}`
      const f = (x: Decimal, o: string, y: Decimal): Decimal => (o === '+' ? x.plus(y) : o === '-' ? x.minus(y) : x.times(y))
      const left = f(new D(a), o1, new D(b))
      const right = o3 === '*' && o2 !== '*' ? f(new D(c), o3, new D(d)) : undefined
      const want = right ? f(left, o2, right) : f(f(left, o2, new D(c)), o3, new D(d))
      // precedence: `L o2 c o3 d` binds * tighter than + / -; when o2 is * and o3 is + / - it is ((L*c) o3 d)
      expect(val(src), src).toBe(want.isZero() ? '0' : want.toFixed())
    }
  })
  it('a + b% / a - b% / a * b% match the formulas', () => {
    for (let i = 0; i < 200; i++) {
      const a = num(), b = String(1 + rnd(200))
      const A = new D(a), B = new D(b)
      expect(val(`${a}+${b}%`)).toBe(A.plus(A.times(B).div(100)).toFixed())
      expect(val(`${a}-${b}%`)).toBe(A.minus(A.times(B).div(100)).isZero() ? '0' : A.minus(A.times(B).div(100)).toFixed())
      expect(val(`${a}*${b}%`)).toBe(A.times(B).div(100).isZero() ? '0' : A.times(B).div(100).toFixed())
    }
  })
  it('Enter chain: feeding the result text back gives the same value when it has <= 10 dp', () => {
    const r = evaluateExpression('12.5*4')
    expect(r.ok && evaluateExpression(r.text).ok && val(r.text)).toBe('50')
  })
})

describe('Phase 82 - no eval, no Function, no JS-number maths in the engine', () => {
  const src = readFileSync(join(__dirname, '..', 'expression.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  it('source has no eval / new Function / parseFloat / Number(', () => {
    expect(src).not.toMatch(/\beval\s*\(/)
    expect(src).not.toMatch(/new\s+Function|\bFunction\s*\(/)
    expect(src).not.toMatch(/parseFloat|parseInt|\bNumber\s*\(/)
  })
})

describe('Phase 82 - percent presets setting', () => {
  it('default, parse, canonical, dedupe, limits', () => {
    expect([...DEFAULT_PERCENT_PRESETS]).toEqual(['18', '5', '3'])
    const ok = (s: string) => { const r = validatePercentPresets(s); if (!r.ok) throw new Error(r.message); return r.text }
    expect(ok('')).toBe('18, 5, 3')
    expect(ok('  ')).toBe('18, 5, 3')
    expect(ok(',,')).toBe('18, 5, 3')
    expect(ok('12,5')).toBe('12, 5')
    expect(ok('5.0, 05, 5.50, 5.5%')).toBe('5, 5.5')
    expect(ok('1000')).toBe('1000')
    expect(ok('0.01')).toBe('0.01')
    expect(ok('1,2,3,4,5,6,7,8')).toBe('1, 2, 3, 4, 5, 6, 7, 8')
    for (const bad of ['0', '-5', '1000.01', '1001', 'abc', '5,x', '1e2', '1,2,3,4,5,6,7,8,9']) expect(validatePercentPresets(bad).ok, bad).toBe(false)
    expect(validatePercentPresets(5 as never).ok).toBe(false)
  })
  it('parsePercent', () => {
    expect(parsePercent('18')).toBe('18')
    expect(parsePercent(' 7.50% ')).toBe('7.5')
    expect(parsePercent('')).toBeNull()
    expect(parsePercent('0')).toBeNull()
    expect(parsePercent('.')).toBeNull()
  })
  it('lenient read of the stored value', () => {
    expect(readPercentPresets({})).toEqual(['18', '5', '3'])
    expect(readPercentPresets({ 'calc.percentPresets': '12, 7' })).toEqual(['12', '7'])
    expect(readPercentPresets({ 'calc.percentPresets': 'garbage' })).toEqual(['18', '5', '3'])
    expect(readPercentPresets({ 'calc.percentPresets': 42 })).toEqual(['18', '5', '3'])
  })
  it('percentResults: % of total, total + %, total - %', () => {
    expect(percentResults('1180', '18')).toEqual({ of: '212.4', plus: '1392.4', minus: '967.6' })
    expect(percentResults('100', '5')).toEqual({ of: '5', plus: '105', minus: '95' })
    expect(percentResults('-100', '10')).toEqual({ of: '-10', plus: '-110', minus: '-90' })
    expect(percentResults('0', '18')).toEqual({ of: '0', plus: '0', minus: '0' })
    expect(percentResults('100', '0')).toBeNull()
    expect(percentResults('x', '5')).toBeNull()
  })
  it('percentResults agree with the expression engine', () => {
    for (const [tot, p] of [['2500', '12'], ['999.99', '3'], ['1', '18']] as const) {
      const r = percentResults(tot, p)!
      const text = (s: string): string => { const x = evaluateExpression(s); if (!x.ok) throw new Error(s); return x.text }
      expect(r.of).toBe(text(`${tot}*${p}%`))
      expect(r.plus).toBe(text(`${tot}+${p}%`))
      expect(r.minus).toBe(text(`${tot}-${p}%`))
    }
  })
})
