import { describe, expect, it } from 'vitest'
import { allShortcuts, findShortcutConflicts } from '../../shortcuts'
import { CALC_PREF_KEYS, DEFAULT_CALC_PREFS, calcLine, commitExpression, grandTotalOf, groupCalcText, otherMode, percentRows, readCalcPrefs, typedPercentInvalid } from '../calcPanel'

describe('calc panel prefs', () => {
  it('keys and defaults: closed, calculator mode', () => {
    expect(CALC_PREF_KEYS).toEqual({ open: 'calc.open', mode: 'calc.mode' })
    expect(DEFAULT_CALC_PREFS).toEqual({ open: false, mode: 'calc' })
  })
  it('reads leniently', () => {
    expect(readCalcPrefs({})).toEqual({ open: false, mode: 'calc' })
    expect(readCalcPrefs({ open: true, mode: 'percent' })).toEqual({ open: true, mode: 'percent' })
    expect(readCalcPrefs({ open: 'yes', mode: 'weird' })).toEqual({ open: false, mode: 'calc' })
    expect(readCalcPrefs({ open: null, mode: null })).toEqual({ open: false, mode: 'calc' })
  })
  it('otherMode flips', () => {
    expect(otherMode('calc')).toBe('percent')
    expect(otherMode('percent')).toBe('calc')
  })
})

describe('grandTotalOf', () => {
  it('reads total (non-GST) and amount (GST), last grandTotal row wins', () => {
    expect(grandTotalOf([{ kind: 'grandTotal', cells: { name: 'Total', total: '1180.00' } }])).toBe('1180.00')
    expect(grandTotalOf([{ kind: 'itemsTotal', cells: { amount: '5.00' } }, { kind: 'grandTotal', cells: { amount: '2360.00', total: '1.00' } }])).toBe('2360.00')
  })
  it('null when there is no total, or it is not a plain number', () => {
    expect(grandTotalOf([])).toBeNull()
    expect(grandTotalOf([{ kind: 'itemsTotal', cells: { total: '5.00' } }])).toBeNull()
    expect(grandTotalOf([{ kind: 'grandTotal', cells: { total: '' } }])).toBeNull()
    expect(grandTotalOf([{ kind: 'grandTotal', cells: { total: 'abc' } }])).toBeNull()
  })
  it('strips commas and keeps a minus sign', () => {
    expect(grandTotalOf([{ kind: 'grandTotal', cells: { total: '-1,250.50' } }])).toBe('-1250.50')
  })
})

describe('groupCalcText', () => {
  it('Indian grouping of the integer part', () => {
    expect(groupCalcText('999')).toBe('999')
    expect(groupCalcText('1000')).toBe('1,000')
    expect(groupCalcText('1234567.5')).toBe('12,34,567.5')
    expect(groupCalcText('-100000')).toBe('-1,00,000')
  })
  it('leaves non-plain text alone', () => {
    expect(groupCalcText('Divide by zero')).toBe('Divide by zero')
    expect(groupCalcText('')).toBe('')
  })
})

describe('calcLine / commitExpression', () => {
  it('empty is neither result nor error', () => {
    expect(calcLine('')).toEqual({ shown: '', error: false, text: null })
    expect(calcLine('   ').error).toBe(false)
  })
  it('live result with grouping, plain text for Enter', () => {
    const l = calcLine('1000*1234')
    expect(l.error).toBe(false)
    expect(l.shown).toBe('12,34,000')
    expect(l.text).toBe('1234000')
  })
  it('percent forms go through the engine', () => {
    expect(calcLine('100 + 18%').text).toBe('118')
    expect(calcLine('200 - 10%').text).toBe('180')
  })
  it('errors are inline, never throw', () => {
    for (const bad of ['1/0', '2 +', '((', 'abc', '1 2']) {
      const l = calcLine(bad)
      expect(l.error).toBe(true)
      expect(l.text).toBeNull()
      expect(l.shown).not.toBe('')
    }
  })
  it('Enter chain: result replaces the expression and can be continued', () => {
    const a = commitExpression('100 + 10%')
    expect(a).toBe('110')
    expect(commitExpression(`${a}*2`)).toBe('220')
    expect(commitExpression('1/0')).toBeNull()
    expect(commitExpression('')).toBeNull()
  })
})

describe('percentRows / typedPercentInvalid', () => {
  it('one row per preset; typed percent appended when new', () => {
    const r = percentRows('1000.00', ['18', '5'], '')
    expect(r.map((x) => x.percent)).toEqual(['18', '5'])
    expect(r[0]!.results).toEqual({ of: '180', plus: '1180', minus: '820' })
    expect(percentRows('1000.00', ['18', '5'], '12.5').map((x) => x.percent)).toEqual(['18', '5', '12.5'])
    expect(percentRows('1000.00', ['18', '5'], '5%').map((x) => x.percent)).toEqual(['18', '5'])
  })
  it('no total, no rows; bad typed percent is ignored and flagged', () => {
    expect(percentRows(null, ['18'], '')).toEqual([])
    expect(percentRows('100', ['18'], 'x').map((x) => x.percent)).toEqual(['18'])
    expect(typedPercentInvalid('x')).toBe(true)
    expect(typedPercentInvalid('0')).toBe(true)
    expect(typedPercentInvalid('1001')).toBe(true)
    expect(typedPercentInvalid('')).toBe(false)
    expect(typedPercentInvalid('18')).toBe(false)
  })
})

describe('shortcut-conflict test (Phase 83)', () => {
  it('Alt+C and Alt+Shift+C are registered once and collide with nothing', () => {
    expect(findShortcutConflicts()).toEqual([])
    const all = allShortcuts()
    expect(all.filter((s) => s.keys === 'Alt+C').map((s) => s.action)).toEqual(['calc.toggle'])
    expect(all.filter((s) => s.keys === 'Alt+Shift+C').map((s) => s.action)).toEqual(['calc.mode'])
  })
})
