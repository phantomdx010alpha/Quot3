import { describe, expect, it } from 'vitest'
import { DASH_TILE_KEYS, DEFAULT_DASH_TILES } from '../live'
import { ageLabel, daysAwayLabel, enabledTiles, localIsoDate, tileRows, tileSpans, TILE_GRID_COLUMNS, TILE_LABELS } from '../tileLayout'

describe('tileRows (Phase 126)', () => {
  for (const w of [1024, 1280, 1920]) {
    for (let n = 1; n <= 6; n++) {
      it(`${n} tile(s) at ${w}px: every row is full (no orphan)`, () => {
        const rows = tileRows(n, w)
        expect(rows.flat()).toHaveLength(n)
        for (const r of rows) expect(r.reduce((a, b) => a + b, 0)).toBe(TILE_GRID_COLUMNS)
      })
    }
  }
  it('six tiles are 3 x 2 when wide and 2 x 3 when narrow', () => {
    expect(tileRows(6, 1920)).toEqual([[4, 4, 4], [4, 4, 4]])
    expect(tileRows(6, 1279)).toEqual([[6, 6], [6, 6], [6, 6]])
  })
  it('five tiles never leave a lone tile: 3 + 2 wide ones', () => { expect(tileRows(5, 1024)).toEqual([[4, 4, 4], [6, 6]]) })
  it('zero and out-of-range counts are safe', () => {
    expect(tileSpans(0, 1280)).toEqual([])
    expect(tileSpans(9, 1280)).toHaveLength(6)
    expect(tileSpans(-2, 1280)).toEqual([])
  })
})

describe('tile helpers', () => {
  it('enabledTiles keeps the fixed order and honours flags', () => {
    expect(enabledTiles(DEFAULT_DASH_TILES)).toEqual([...DASH_TILE_KEYS])
    expect(enabledTiles({ ...DEFAULT_DASH_TILES, usd: false, clock: false })).toEqual(['weather', 'majors', 'metals', 'holidays'])
  })
  it('every tile has a label', () => { for (const k of DASH_TILE_KEYS) expect(TILE_LABELS[k]).not.toBe('') })
  it('localIsoDate uses local fields', () => { expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05') })
  it('ageLabel', () => {
    const now = Date.parse('2026-10-11T12:00:00Z')
    expect(ageLabel(null, now)).toBe('')
    expect(ageLabel('bad', now)).toBe('')
    expect(ageLabel('2026-10-11T11:59:40Z', now)).toBe('just now')
    expect(ageLabel('2026-10-11T11:30:00Z', now)).toBe('30 min ago')
    expect(ageLabel('2026-10-11T09:00:00Z', now)).toBe('3 h ago')
    expect(ageLabel('2026-10-05T12:00:00Z', now)).toBe('6 d ago')
  })
  it('daysAwayLabel', () => { expect([0, 1, 5].map(daysAwayLabel)).toEqual(['Today', 'Tomorrow', 'In 5 days']) })
})
