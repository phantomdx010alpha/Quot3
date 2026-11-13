import { describe, expect, it } from 'vitest'
import { isInCase, nextCaseMode, transformRuns } from '../caseTransform'
import { fromPlain, plain, rangeState, toggleBold, toggleHighlight, toggleRed } from '../runs'
import { allActions, allShortcuts, primaryKeys } from '../../shortcuts'
import { shortcutRows } from '../../shortcutList'
import { TOOLBAR_NAMES, TOOLBAR_NAME_MAX } from '../../toolbarNames'

describe('caseTransform (Phase 234)', () => {
  it('upper and lower keep the text length-independent flags on the same letters', () => {
    let r = fromPlain('copper wire 5mm')
    r = toggleBold(r, 0, 6); r = toggleRed(r, 7, 11); r = toggleHighlight(r, 12, 15)
    const up = transformRuns(r, 'upper')
    expect(plain(up)).toBe('COPPER WIRE 5MM')
    expect(rangeState(up, 0, 6, 'b')).toBe('all'); expect(rangeState(up, 7, 11, 'r')).toBe('all'); expect(rangeState(up, 12, 15, 'hl')).toBe('all')
    expect(rangeState(up, 7, 11, 'b')).toBe('none')
    const low = transformRuns(up, 'lower')
    expect(plain(low)).toBe('copper wire 5mm')
    expect(rangeState(low, 0, 6, 'b')).toBe('all'); expect(rangeState(low, 7, 11, 'r')).toBe('all')
  })
  it('length-changing Unicode ("\u00DF") stays inside its own run', () => {
    const r = toggleBold(fromPlain('stra\u00DFe tank'), 4, 5) // the sharp s is bold
    const up = transformRuns(r, 'upper')
    expect(plain(up)).toBe('STRASSE TANK')
    expect(rangeState(up, 4, 6, 'b')).toBe('all') // "SS" carries the bold
    expect(rangeState(up, 0, 4, 'b')).toBe('none'); expect(rangeState(up, 6, 12, 'b')).toBe('none')
    expect(plain(transformRuns(fromPlain('\u0130stanbul'), 'lower')).length).toBeGreaterThan(0) // no throw on special letters
  })
  it('emoji and non-letters are untouched; no letters / no change returns the same runs', () => {
    const r = fromPlain('\u{1F600} 12-5 /')
    expect(transformRuns(r, 'upper')).toBe(r)
    expect(plain(transformRuns(fromPlain('a\u{1F600}b'), 'upper'))).toBe('A\u{1F600}B')
    expect(transformRuns([], 'upper')).toEqual([])
    const already = fromPlain('ABC')
    expect(transformRuns(already, 'upper')).toBe(already)
  })
  it('optional title mode', () => {
    expect(plain(transformRuns(fromPlain('copper WIRE by-hand o\u2019neil'), 'title'))).toBe('Copper Wire By-Hand O\u2019neil')
  })
  it('the cycle: mixed or lower -> UPPER, all UPPER -> lower; names without letters are ignored', () => {
    expect(nextCaseMode(['Copper wire', 'tank'])).toBe('upper')
    expect(nextCaseMode(['COPPER', 'TANK'])).toBe('lower')
    expect(nextCaseMode(['COPPER', '12', '', 'TANK'])).toBe('lower')
    expect(nextCaseMode(['copper', 'TANK'])).toBe('upper')
    expect(nextCaseMode([])).toBe('upper')
    expect(nextCaseMode(['12'])).toBe('upper')
    expect(isInCase('A-1', 'upper')).toBe(true); expect(isInCase('Ab', 'upper')).toBe(false)
  })
})

describe('Case button registration (Phase 234)', () => {
  it('has one action, one grid shortcut, a palette entry, a short toolbar name', () => {
    expect(allActions().filter((a) => a.id === 'grid.caseNames')).toHaveLength(1)
    const keys = allShortcuts().filter((s) => s.action === 'grid.caseNames')
    expect(keys).toHaveLength(1)
    expect(primaryKeys('grid.caseNames')).toBe('Ctrl+Shift+Q')
    expect(allShortcuts().filter((s) => s.keys === 'Ctrl+Shift+Q')).toHaveLength(1)
    expect(shortcutRows().some((r) => r.action === 'grid.caseNames')).toBe(true)
    expect(TOOLBAR_NAMES['grid.caseNames']).toBe('Case')
    expect(TOOLBAR_NAMES['grid.caseNames'].length).toBeLessThanOrEqual(TOOLBAR_NAME_MAX)
  })
})
