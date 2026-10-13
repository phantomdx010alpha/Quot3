import { describe, expect, it } from 'vitest'
import { formatTsv, looksLikeTsv, parseTsv } from '../tsvCodec'
import { describePaste, parseQuot3Payload, planPaste, repeatCell, serializeQuot3Payload, type PasteCol } from '../gridClip'

describe('parseTsv / formatTsv', () => {
  it('basic rows and cells, LF / CRLF / CR', () => {
    expect(parseTsv('a\tb\nc\td')).toEqual([['a', 'b'], ['c', 'd']])
    expect(parseTsv('a\tb\r\nc\td')).toEqual([['a', 'b'], ['c', 'd']])
    expect(parseTsv('a\rb')).toEqual([['a'], ['b']])
  })
  it("Excel's single trailing separator adds no row; empty text is no rows", () => {
    expect(parseTsv('a\r\nb\r\n')).toEqual([['a'], ['b']])
    expect(parseTsv('')).toEqual([])
    expect(parseTsv('\n')).toEqual([['']])
    expect(parseTsv('a\r\n\r\n')).toEqual([['a'], ['']])
  })
  it('empty cells are kept (leading, middle, trailing tabs)', () => {
    expect(parseTsv('\ta\t\t')).toEqual([['', 'a', '', '']])
  })
  it('quoted cells hold tabs, newlines and doubled quotes', () => {
    expect(parseTsv('"a\tb"\tc')).toEqual([['a\tb', 'c']])
    expect(parseTsv('"line1\r\nline2"\tx\r\ny\tz')).toEqual([['line1\r\nline2', 'x'], ['y', 'z']])
    expect(parseTsv('"say ""hi"""\tz')).toEqual([['say "hi"', 'z']])
  })
  it('a quote in the middle of an unquoted cell is literal; an unterminated quote runs to the end', () => {
    expect(parseTsv('5" pipe\tx')).toEqual([['5" pipe', 'x']])
    expect(parseTsv('"open\tcell')).toEqual([['open\tcell']])
  })
  it('format quotes only when needed and round-trips', () => {
    expect(formatTsv([['a', 'b'], ['c', 'd']])).toBe('a\tb\r\nc\td')
    expect(formatTsv([['x\ty', 'z"q', 'n\nm', 'plain']])).toBe('"x\ty"\t"z""q"\t"n\nm"\tplain')
    const cases: string[][][] = [[['a']], [['', '']], [['x\ty', 'z"q', 'n\r\nm', '']], [['1'], ['2'], ['']], [['"', '""', '"a"']]]
    for (const c of cases) expect(parseTsv(formatTsv(c))).toEqual(c)
  })
  it('looksLikeTsv: tab, or trailing separator with ≥ 2 rows; plain multi-line text is not', () => {
    expect(looksLikeTsv('a\tb')).toBe(true)
    expect(looksLikeTsv('a\r\nb\r\n')).toBe(true)
    expect(looksLikeTsv('one line')).toBe(false)
    expect(looksLikeTsv('one\ntwo')).toBe(false)
    expect(looksLikeTsv('one\n')).toBe(false)
  })
})

const cols: PasteCol[] = [
  { key: 'name', numeric: false, typable: true, allowNegative: false },
  { key: 'rate', numeric: true, typable: true, allowNegative: false },
  { key: 'qty', numeric: true, typable: true, allowNegative: false },
  { key: 'total', numeric: true, typable: true, allowNegative: true }
]
const m = (rows: string[][]) => rows.map((r) => r.map((text) => ({ text })))

describe('planPaste', () => {
  it('places cells from the start cell, expanding rows and columns', () => {
    const p = planPaste(m([['Ruby', '10', '2'], ['Tomato', '5', '3']]), 4, 0, cols)
    expect(p.rowsNeeded).toBe(6)
    expect(p.cells.map((c) => [c.row, c.col, c.text])).toEqual([[4, 0, 'Ruby'], [4, 1, '10'], [4, 2, '2'], [5, 0, 'Tomato'], [5, 1, '5'], [5, 2, '3']])
    expect(p.rejected).toEqual([])
  })
  it('starting mid-grid shifts columns; overflowing columns are counted, never silent', () => {
    const p = planPaste(m([['1', '2', '3']]), 0, 2, cols)
    expect(p.cells.map((c) => c.col)).toEqual([2, 3])
    expect(p.clippedCols).toBe(1)
  })
  it('numeric cells: commas/₹ tolerated, blanks clear, garbage rejected for that cell only', () => {
    const p = planPaste(m([['Item', '1,250', 'abc'], ['x', '₹ 90', ''], ['y', '-5', '1e3']]), 0, 0, cols)
    const at = (r: number, c: number) => p.cells.find((x) => x.row === r && x.col === c)?.text
    expect(at(0, 1)).toBe('1250')
    expect(at(1, 1)).toBe('90')
    expect(at(1, 2)).toBe('') // blank clears
    expect(at(0, 0)).toBe('Item')
    expect(p.rejected.map((r) => [r.row, r.col, r.text])).toEqual([[0, 2, 'abc'], [2, 1, '-5'], [2, 2, '1e3']])
  })
  it('negative is accepted in Total only', () => {
    const p = planPaste(m([['n', '1', '1', '-40']]), 0, 0, cols)
    expect(p.cells.find((c) => c.col === 3)?.text).toBe('-40')
    expect(p.rejected).toEqual([])
  })
  it('newlines and tabs inside a text cell become spaces; extra-column text passes through', () => {
    const p = planPaste([[{ text: 'a\nb\r\nc' }]], 0, 0, cols)
    expect(p.cells[0]?.text).toBe('a b c')
  })
  it('runs are kept for the name column only', () => {
    const runs = [{ t: 'Red', r: 1 as const, b: 1 as const }]
    const p = planPaste([[{ text: 'Red', runs }, { text: '5', runs }]], 0, 0, cols)
    expect(p.cells[0]?.runs).toEqual(runs)
    expect(p.cells[1]?.runs).toBeUndefined()
  })
  it('read-only columns are skipped and counted', () => {
    const ro: PasteCol[] = [{ key: 'name', numeric: false, typable: false, allowNegative: false }]
    const p = planPaste(m([['x']]), 0, 0, ro)
    expect(p.cells).toEqual([])
    expect(p.skipped).toBe(1)
  })
  it('repeatCell fills a block; describePaste reports rejects once', () => {
    expect(repeatCell({ text: 'z' }, 2, 3)).toHaveLength(2)
    const p = planPaste(m([['n', 'abc'], ['n', 'def']]), 0, 0, cols)
    const msg = describePaste(p, (k) => k.toUpperCase())
    expect(msg).toContain('2 cells not pasted')
    expect(msg).toContain('RATE')
    expect(describePaste(planPaste(m([['a']]), 0, 0, cols), (k) => k)).toBe('')
  })
})

describe('Quot3 flavour', () => {
  it('round-trips text and runs; malformed input → null', () => {
    const cells = [[{ text: 'Hi', runs: [{ t: 'H', b: 1 as const }, { t: 'i' }] }, { text: '5' }]]
    expect(parseQuot3Payload(serializeQuot3Payload(cells))?.cells).toEqual(cells)
    for (const bad of ['', 'nope', '{}', '{"v":2,"cells":[[]]}', '{"v":1,"cells":[]}', '{"v":1,"cells":[[{"x":1}]]}', null, undefined]) expect(parseQuot3Payload(bad as string)).toBeNull()
  })
  it('drops invalid runs but keeps the text', () => {
    const p = parseQuot3Payload('{"v":1,"cells":[[{"text":"a","runs":[{"nope":1}]}]]}')
    expect(p?.cells[0]?.[0]).toEqual({ text: 'a' })
  })
})
