import { describe, expect, it } from 'vitest'
import { D, add, fmtMoney, fmtQty, isNumericStr, mul, round2, roundInt, sum, toDec, toMoney, tryD } from '../money'

describe('D / tryD / isNumericStr', () => {
  it('blank/null/undefined → 0; strings parsed exactly', () => {
    expect(D(null).toFixed()).toBe('0')
    expect(D(undefined).toFixed()).toBe('0')
    expect(D('  ').toFixed()).toBe('0')
    expect(D(' 12.50 ').toFixed()).toBe('12.5')
    expect(D('-.5').toFixed()).toBe('-0.5')
  })
  it('throws on non-numeric, exponents, hex, NaN, Infinity', () => {
    for (const bad of ['abc', '1e3', '0x10', 'NaN', 'Infinity', '1,000', '--1', '1.2.3', '-'])
      expect(() => D(bad), bad).toThrow()
    expect(() => D(Number.NaN)).toThrow()
  })
  it('tryD returns null instead of throwing', () => {
    expect(tryD('1e3')).toBeNull()
    expect(tryD('')).toBeNull()
    expect(tryD(null)).toBeNull()
    expect(tryD('7')?.toFixed()).toBe('7')
  })
  it('isNumericStr accepts complete cell values only', () => {
    for (const ok of ['0', '12', '12.', '.5', '-3', '-0.25', '1250.50']) expect(isNumericStr(ok), ok).toBe(true)
    for (const no of ['', '-', '.', '1e3', 'a1', '1 2', '+1', '1,0']) expect(isNumericStr(no), no).toBe(false)
  })
})

describe('exactness (no floating point)', () => {
  it('0.1 + 0.2 = 0.3 exactly', () => {
    expect(add('0.1', '0.2').toFixed()).toBe('0.3')
    expect(toDec(add('0.1', '0.2'))).toBe('0.3')
  })
  it('classic float traps', () => {
    expect(mul('1.1', '1.1').toFixed()).toBe('1.21')
    expect(toMoney(mul('19.99', '3'))).toBe('59.97')
    expect(sum(['0.1', '0.1', '0.1', '0.1', '0.1', '0.1', '0.1', '0.1', '0.1', '0.1']).toFixed()).toBe('1')
    expect(toMoney(mul('0.07', '100'))).toBe('7.00')
  })
  it('sums a million values exactly', () => {
    const vals = new Array<string>(1_000_000).fill('0.01')
    expect(sum(vals).toFixed()).toBe('10000')
    expect(toDec(sum(['9007199254740993', '1']))).toBe('9007199254740994') // beyond 2^53
  }, 30_000)
})

describe('rounding (ROUND_HALF_UP)', () => {
  it('round2 rounds halves away from zero', () => {
    expect(round2(D('1.005')).toFixed()).toBe('1.01')
    expect(round2(D('2.675')).toFixed()).toBe('2.68')
    expect(round2(D('-1.005')).toFixed()).toBe('-1.01')
    expect(round2(D('0.004')).toFixed()).toBe('0')
    expect(roundInt(D('2.5')).toFixed()).toBe('3')
    expect(roundInt(D('-2.5')).toFixed()).toBe('-3')
  })
  it('toMoney is 2dp and never "-0.00"', () => {
    expect(toMoney(D('90'))).toBe('90.00')
    expect(toMoney(D('1250.5'))).toBe('1250.50')
    expect(toMoney(D('-0.001'))).toBe('0.00')
    expect(toDec(D('-0'))).toBe('0')
  })
})

describe('formatting', () => {
  it('fmtQty trims', () => {
    expect(fmtQty('10.0')).toBe('10')
    expect(fmtQty('12.50')).toBe('12.5')
    expect(fmtQty('0.250')).toBe('0.25')
    expect(fmtQty('')).toBe('')
    expect(fmtQty(null)).toBe('')
    expect(fmtQty('x')).toBe('')
  })
  it('fmtMoney: 2dp, Indian grouping, rupee symbol, negatives', () => {
    expect(fmtMoney('1250.5')).toBe('1250.50')
    expect(fmtMoney('107500', { indian: true, symbol: true })).toBe('₹1,07,500.00')
    expect(fmtMoney('999', { indian: true })).toBe('999.00')
    expect(fmtMoney('1000', { indian: true })).toBe('1,000.00')
    expect(fmtMoney('12345678.9', { indian: true })).toBe('1,23,45,678.90')
    expect(fmtMoney('-1500', { indian: true, symbol: true })).toBe('-₹1,500.00')
    expect(fmtMoney('-0.001', { symbol: true })).toBe('₹0.00')
    expect(fmtMoney('1.005')).toBe('1.01')
  })
})
