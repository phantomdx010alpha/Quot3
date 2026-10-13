import { describe, expect, it } from 'vitest'
import type { Paper, PrintMode } from '../../types'
import { A4_MAX_ROWS, A5_MAX_ROWS } from '../paperConstants'
import { decidePaper } from '../paperRules'

const NG = 'non_gst'
const GST = 'gst'

/** PAPER_ENGINE_RULES §6 - every row of the matrix. [label, mode, format, rows, extras, extra input, size, pages, warning?, ack] */
type Row = [string, PrintMode, string, number, number, { forced?: Paper; measuredOverflow?: boolean }, Paper, number, boolean, boolean]
const MATRIX: Row[] = [
  ['rough non-GST 40/0', 'rough', NG, 40, 0, {}, 'A5', 1, false, false],
  ['rough non-GST 41/0', 'rough', NG, 41, 0, {}, 'A4', 1, false, false],
  ['rough non-GST 80/0', 'rough', NG, 80, 0, {}, 'A4', 1, false, false],
  ['rough non-GST 81/0', 'rough', NG, 81, 0, {}, 'A4', 2, false, false],
  ['pro non-GST 30/0', 'professional', NG, 30, 0, {}, 'A5', 1, false, false],
  ['pro non-GST 31/0', 'professional', NG, 31, 0, {}, 'A4', 1, false, false],
  ['pro non-GST 70/0', 'professional', NG, 70, 0, {}, 'A4', 1, false, false],
  ['pro non-GST 71/0', 'professional', NG, 71, 0, {}, 'A4', 2, false, false],
  ['rough non-GST 10/2', 'rough', NG, 10, 2, {}, 'A5', 1, false, false],
  ['rough non-GST 10/3', 'rough', NG, 10, 3, {}, 'A4', 1, true, true],
  ['rough non-GST 50/3', 'rough', NG, 50, 3, {}, 'A4', 1, true, true],
  ['rough GST 10/0', 'rough', GST, 10, 0, {}, 'A5', 1, false, false],
  ['rough GST 10/1', 'rough', GST, 10, 1, {}, 'A4', 1, true, true],
  ['pro GST 31/0', 'professional', GST, 31, 0, {}, 'A4', 1, false, false],
  ['forced A4, small bill (rough non-GST)', 'rough', NG, 10, 0, { forced: 'A4' }, 'A4', 1, false, false],
  ['forced A4, small bill (pro GST)', 'professional', GST, 10, 0, { forced: 'A4' }, 'A4', 1, false, false],
  ['forced A5 with 60 rows', 'rough', NG, 60, 0, { forced: 'A5' }, 'A5', 2, true, false],
  ['measured overflow', 'rough', NG, 10, 0, { measuredOverflow: true }, 'A4', 1, true, false]
]

describe('Phase 36 - decidePaper: the §6 test matrix', () => {
  for (const [label, mode, formatId, rowCount, extraColCount, extra, size, pages, warns, ack] of MATRIX) {
    it(label, () => {
      const d = decidePaper({ mode, formatId, rowCount, extraColCount, ...extra })
      expect(d.size).toBe(size)
      expect(d.pages).toBe(pages)
      expect(d.warnings.length > 0).toBe(warns)
      expect(d.requiresAck).toBe(ack)
    })
  }
})

describe('Phase 36 - decidePaper: texts and detail', () => {
  it('rule 2 wording: non-GST names the limit, GST says GST bills', () => {
    expect(decidePaper({ mode: 'rough', formatId: NG, rowCount: 5, extraColCount: 3 }).warnings).toEqual(['More than 2 extra columns — printing on A4 due to layout limits.'])
    expect(decidePaper({ mode: 'rough', formatId: GST, rowCount: 5, extraColCount: 1 }).warnings).toEqual(['GST bills with extra columns print on A4.'])
  })
  it('rule 2 comes before rule 3: 50 rows + 3 extras warns and needs an ack', () => {
    const d = decidePaper({ mode: 'rough', formatId: NG, rowCount: 50, extraColCount: 3 })
    expect(d.warnings).toHaveLength(1)
    expect(d.requiresAck).toBe(true)
  })
  it('row-count fallback is a reason, not a warning: "41 rows exceeds A5 limit of 40"', () => {
    const d = decidePaper({ mode: 'rough', formatId: NG, rowCount: 41, extraColCount: 0 })
    expect(d.warnings).toEqual([])
    expect(d.reasons[0]).toBe('41 rows exceeds A5 limit of 40')
    expect(d.suggested).toBe('A4')
  })
  it('extra columns + more rows than one A4 page still paginates', () => {
    const d = decidePaper({ mode: 'rough', formatId: NG, rowCount: 170, extraColCount: 3 })
    expect(d).toMatchObject({ size: 'A4', pages: 3, requiresAck: true })
  })
  it('forced A5 when rules say A4: warning text carries rows and extra columns; suggested stays A4; no ack', () => {
    const d = decidePaper({ mode: 'rough', formatId: NG, rowCount: 60, extraColCount: 0, forced: 'A5' })
    expect(d.warnings).toEqual(['Content may be cramped on A5 (60 rows / 0 extra columns)'])
    expect(d.suggested).toBe('A4')
    expect(d.requiresAck).toBe(false)
  })
  it('forced wins over everything: forced A4 for a GST bill with extras shows no warning and no ack', () => {
    const d = decidePaper({ mode: 'rough', formatId: GST, rowCount: 5, extraColCount: 2, forced: 'A4' })
    expect(d).toMatchObject({ size: 'A4', pages: 1, suggested: 'A4', warnings: [], requiresAck: false })
  })
  it('forced A5 that the rules also pick: no warning', () => {
    expect(decidePaper({ mode: 'rough', formatId: NG, rowCount: 10, extraColCount: 0, forced: 'A5' }).warnings).toEqual([])
  })
  it('measured overflow: reason text, no ack, and it only applies to an A5 result', () => {
    const d = decidePaper({ mode: 'rough', formatId: NG, rowCount: 10, extraColCount: 0, measuredOverflow: true })
    expect(d.reasons).toEqual(['Content did not fit A5 after wrapping long text — switched to A4.'])
    expect(d.requiresAck).toBe(false)
    const already = decidePaper({ mode: 'rough', formatId: NG, rowCount: 50, extraColCount: 0, measuredOverflow: true })
    expect(already.warnings).toEqual([])
    expect(already.reasons[0]).toBe('50 rows exceeds A5 limit of 40')
  })
  it('zero rows, negative, NaN and fractional counts are tolerated', () => {
    expect(decidePaper({ mode: 'rough', formatId: NG, rowCount: 0, extraColCount: 0 })).toMatchObject({ size: 'A5', pages: 1 })
    expect(decidePaper({ mode: 'rough', formatId: NG, rowCount: -5, extraColCount: Number.NaN })).toMatchObject({ size: 'A5', pages: 1 })
    expect(decidePaper({ mode: 'rough', formatId: NG, rowCount: 40.9, extraColCount: 0 }).size).toBe('A5')
  })
  it('an unknown format id throws (never silently guesses)', () => {
    expect(() => decidePaper({ mode: 'rough', formatId: 'nope', rowCount: 1, extraColCount: 0 })).toThrow(/Unknown format/)
  })
  it('thresholds are the owner numbers (read from paperConstants, asserted once here)', () => {
    expect(A5_MAX_ROWS).toEqual({ rough: 40, professional: 30 })
    expect(A4_MAX_ROWS).toEqual({ rough: 80, professional: 70 })
  })
})

const rank = (s: Paper): number => (s === 'A5' ? 0 : 1)
const MODES: PrintMode[] = ['rough', 'professional']
const FORMATS = [NG, GST]

describe('Phase 36 - decidePaper: properties (exhaustive sweeps)', () => {
  it('more rows never yields a smaller page or fewer pages (unforced)', () => {
    for (const mode of MODES) for (const formatId of FORMATS) for (let extra = 0; extra <= 5; extra++) {
      let prev = decidePaper({ mode, formatId, rowCount: 0, extraColCount: extra })
      for (let rows = 1; rows <= 400; rows++) {
        const cur = decidePaper({ mode, formatId, rowCount: rows, extraColCount: extra })
        expect(rank(cur.size), `${mode} ${formatId} x${extra} r${rows}`).toBeGreaterThanOrEqual(rank(prev.size))
        if (prev.size === 'A4') expect(cur.pages, `${mode} ${formatId} x${extra} r${rows}`).toBeGreaterThanOrEqual(prev.pages)
        prev = cur
      }
    }
  })
  it('more extra columns never yields a smaller page; beyond the format limit it is never A5', () => {
    for (const mode of MODES) for (const formatId of FORMATS) for (const rows of [0, 1, 10, 30, 31, 40, 41, 80, 81, 200]) {
      let prev = decidePaper({ mode, formatId, rowCount: rows, extraColCount: 0 })
      for (let extra = 1; extra <= 12; extra++) {
        const cur = decidePaper({ mode, formatId, rowCount: rows, extraColCount: extra })
        expect(rank(cur.size)).toBeGreaterThanOrEqual(rank(prev.size))
        prev = cur
      }
    }
    // beyond-limit: the smallest count that exceeds each format's limit and everything above it
    const limit: Record<string, number> = { [NG]: 2, [GST]: 0 }
    for (const mode of MODES) for (const formatId of FORMATS) for (let extra = (limit[formatId] ?? 0) + 1; extra <= 12; extra++) {
      expect(decidePaper({ mode, formatId, rowCount: 1, extraColCount: extra }).size).toBe('A4')
    }
  })
  it('pages are always >= 1, A5 unforced is always exactly 1 page, and the forced size is always honoured', () => {
    for (const mode of MODES) for (const formatId of FORMATS) for (let rows = 0; rows <= 300; rows += 7) for (let extra = 0; extra <= 4; extra++) {
      const d = decidePaper({ mode, formatId, rowCount: rows, extraColCount: extra })
      expect(d.pages).toBeGreaterThanOrEqual(1)
      if (d.size === 'A5') expect(d.pages).toBe(1)
      for (const forced of ['A4', 'A5'] as const) expect(decidePaper({ mode, formatId, rowCount: rows, extraColCount: extra, forced }).size).toBe(forced)
    }
  })
})
