import { describe, expect, it } from 'vitest'
import { A4_MAX_ROWS, A5_MAX_ROWS } from '../../paper/paperConstants'
import { FIT_CAP_RANGE, FIT_DEFAULT_CAP, FIT_FILL, fitCapFor, fitEstimate, fitScaleSearch, fitsBudget, normalizeFitCap, pageHeightPx, DEFAULT_FIT_SETTINGS } from '../fitScale'
import { contentHeightPx, resolvePrintSettings } from '../printFlow'
import { fitCss, printCss } from '../template/printCss'

const H5 = pageHeightPx('A5')
const H4 = pageHeightPx('A4')

describe('Phase 148 - fit engine (pure)', () => {
  it('uses the same page height as printFlow, and the paper thresholds are untouched', () => {
    expect(H5).toBe(contentHeightPx('A5'))
    expect(H4).toBe(contentHeightPx('A4'))
    expect(A5_MAX_ROWS).toEqual({ rough: 40, professional: 30 })
    expect(A4_MAX_ROWS).toEqual({ rough: 80, professional: 70 })
  })

  it('cap normalisation: clamped to 1..2, junk -> the paper default', () => {
    expect(normalizeFitCap(1.35, 'A5')).toBe(1.35)
    expect(normalizeFitCap(0.5, 'A5')).toBe(FIT_CAP_RANGE.min)
    expect(normalizeFitCap(9, 'A4')).toBe(FIT_CAP_RANGE.max)
    expect(normalizeFitCap('x', 'A4')).toBe(FIT_DEFAULT_CAP.A4)
    expect(normalizeFitCap(NaN, 'A5')).toBe(FIT_DEFAULT_CAP.A5)
  })

  // table: [name, paper, bottom at 1 (fraction of page), cap, expected estimate]
  const table: Array<[string, 'A5' | 'A4', number, number, number]> = [
    ['5-6 rows A5 stays compact (capped)', 'A5', 0.15, 1.35, 1.35],
    ['5-6 rows A4 stays compact (capped)', 'A4', 0.1, 1.25, 1.25],
    ['10 rows A5 bounded by the cap', 'A5', 0.3, 1.35, 1.35],
    ['half-page A5 uses the room (0.96/0.5 floors to 1.9, cap 1.35)', 'A5', 0.5, 1.35, 1.35],
    ['75% page A5: room for 1.25', 'A5', 0.75, 1.35, 1.25],
    ['85% page A4: room for 1.1', 'A4', 0.85, 1.25, 1.1],
    ['full A5 (40 rough rows) stays 1', 'A5', 0.99, 1.35, 1],
    ['full A4 (80 rough rows) stays 1', 'A4', 1.0, 1.25, 1],
    ['cap 1 = never', 'A5', 0.2, 1, 1]
  ]
  for (const [name, paper, frac, cap, want] of table) {
    it(`estimate: ${name}`, () => {
      const h = paper === 'A5' ? H5 : H4
      expect(fitEstimate(Math.round(h * frac), paper, cap)).toBe(want)
    })
  }
  it('estimate never goes below 1 or above the cap, and handles junk input', () => {
    expect(fitEstimate(0, 'A5', 1.35)).toBe(1)
    expect(fitEstimate(-5, 'A5', 1.35)).toBe(1)
    expect(fitEstimate(Infinity, 'A5', 1.35)).toBe(1)
    expect(fitEstimate(10, 'A5', 5)).toBe(2) // cap clamps to the range max
  })

  it('search: linear growth -> the estimate; every accepted result fits the budget', async () => {
    const bottom1 = Math.round(H5 * 0.75)
    const r = await fitScaleSearch(async (s) => bottom1 * s, 'A5', 1.35)
    expect(r.scale).toBe(1.25)
    expect(fitsBudget('A5', bottom1 * r.scale)).toBe(true)
    expect(r.measures).toBe(2)
  })
  it('search: wrapping makes height grow faster than linearly -> steps down until it fits (never overflows)', async () => {
    const bottom1 = Math.round(H5 * 0.55)
    const grow = (s: number): number => bottom1 * s * s * s // cubic: worse than linear
    const r = await fitScaleSearch(async (s) => grow(s), 'A5', 1.35)
    expect(r.scale).toBeGreaterThan(1)
    expect(r.scale).toBeLessThan(1.35)
    expect(grow(r.scale)).toBeLessThanOrEqual(H5 * FIT_FILL)
  })
  it('search: if nothing in the tries fits, keep 1', async () => {
    const r = await fitScaleSearch(async (s) => (s === 1 ? Math.round(H5 * 0.9) : H5 * 5), 'A5', 1.35)
    expect(r.scale).toBe(1)
  })
  it('search: a bill that already overflows one page, or cap 1, is not measured further', async () => {
    let calls = 0
    const over = await fitScaleSearch(async () => { calls++; return H5 * 2 }, 'A5', 1.35)
    expect(over).toEqual({ scale: 1, measures: 1 })
    expect(calls).toBe(1)
    const none = await fitScaleSearch(async () => { calls++; return 10 }, 'A5', 1)
    expect(none).toEqual({ scale: 1, measures: 0 })
  })
  it('search: a throwing measurement propagates (the caller keeps the normal size)', async () => {
    await expect(fitScaleSearch(async () => { throw new Error('x') }, 'A4', 1.25)).rejects.toThrow('x')
  })

  it('settings resolve: default ON with 1.35 / 1.25; Off and caps read from the keys; junk is tolerated', () => {
    expect(resolvePrintSettings({}).fit).toEqual(DEFAULT_FIT_SETTINGS)
    expect(resolvePrintSettings({ 'print.fitToPage': false }).fit.enabled).toBe(false)
    expect(resolvePrintSettings({ 'print.fitToPage': 'no' }).fit.enabled).toBe(true)
    expect(resolvePrintSettings({ 'print.fitMaxA5': 1.5, 'print.fitMaxA4': 'x' }).fit).toMatchObject({ capA5: 1.5, capA4: 1.25 })
    expect(fitCapFor(DEFAULT_FIT_SETTINGS, 'A5')).toBe(1.35)
    expect(fitCapFor(DEFAULT_FIT_SETTINGS, 'A4')).toBe(1.25)
  })
})

describe('Phase 148 - fit CSS', () => {
  const font = { fontBaseUrl: 'file:///f' }
  it('no factor / 1 / density tier > 0 = no override, so the stylesheet is byte-identical to before', () => {
    const base = printCss('A5', font)
    expect(printCss('A5', font, 0, undefined)).toBe(base)
    expect(printCss('A5', font, 0, 1)).toBe(base)
    expect(printCss('A4', font, 2, 1.25)).toBe(printCss('A4', font, 2))
    expect(fitCss('A5', 0.9)).toBe('')
    expect(fitCss('A5', NaN)).toBe('')
  })
  it('a factor scales the type sizes and the cell padding together, after the base tokens', () => {
    expect(fitCss('A5', 1.35)).toBe(':root{--print-fs:10.125pt;--print-fs-head:9.45pt;--print-fs-party:14.85pt;--print-pad-y:0.405mm}')
    const css = printCss('A4', font, 0, 1.25)
    expect(css).toContain('--print-fs:11.25pt')
    expect(css.indexOf('--print-fs:11.25pt')).toBeGreaterThan(css.indexOf('--print-fs:9pt'))
  })
  it('only sizes change: no vertical centring or positioning was added', () => {
    const css = fitCss('A4', 1.25)
    expect(css).not.toMatch(/margin|top|align|flex|transform|zoom/)
  })
})
