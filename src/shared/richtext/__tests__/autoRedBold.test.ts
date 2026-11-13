import { describe, expect, it } from 'vitest'
import { AUTO_RED_BOLD_DEFAULTS, DEFAULT_AUTO_RED_BOLD, applyAutoRedBold, findPhraseRanges, normalizePhrases, parsePhraseList, readAutoRedBold, type AutoRedBoldConfig } from '../autoRedBold'
import { applyTextChange, clearFormat, fromPlain, plain, rangeState } from '../runs'
import { applyCellText } from '../../gridEdit'
import { SETTING_DEFAULTS, SETTING_KEY_RE } from '../../settings'
import { createEmptyRow } from '../../billModel'
import type { Runs } from '../../types'

const cfg: AutoRedBoldConfig = { enabled: true, phrases: ['by hand'], when: 'word' }
/** Type `next` over `prev` the way the grid does (text change, then auto red-bold). */
const edit = (prev: Runs, next: string, c: AutoRedBoldConfig = cfg, leaving = true): Runs => applyAutoRedBold(prev, applyTextChange(prev, next), c, { leaving })
const redBold = (r: Runs, s: number, e: number): boolean => rangeState(r, s, e, 'r') === 'all' && rangeState(r, s, e, 'b') === 'all'
const noFormat = (r: Runs, s: number, e: number): boolean => rangeState(r, s, e, 'r') === 'none' && rangeState(r, s, e, 'b') === 'none'

describe('autoRedBold (Phase 233)', () => {
  it('start / middle / end of the name', () => {
    const a = edit(fromPlain(''), 'by hand copper wire')
    expect(redBold(a, 0, 7)).toBe(true); expect(noFormat(a, 8, 19)).toBe(true)
    const b = edit(fromPlain(''), 'copper by hand wire')
    expect(redBold(b, 7, 14)).toBe(true); expect(noFormat(b, 0, 6)).toBe(true); expect(noFormat(b, 15, 19)).toBe(true)
    const c = edit(fromPlain(''), 'copper wire by hand')
    expect(redBold(c, 12, 19)).toBe(true); expect(noFormat(c, 0, 11)).toBe(true)
    expect(plain(c)).toBe('copper wire by hand')
  })
  it('case-insensitive, and the text itself is never changed', () => {
    const r = edit(fromPlain(''), 'Wire BY Hand')
    expect(plain(r)).toBe('Wire BY Hand'); expect(redBold(r, 5, 12)).toBe(true)
  })
  it('whole words only', () => {
    expect(findPhraseRanges('by handle', ['by hand'])).toEqual([])
    expect(findPhraseRanges('standby hand', ['by hand'])).toEqual([])
    expect(findPhraseRanges('by hand-made', ['by hand'])).toEqual([{ start: 0, end: 7 }])
    const r = edit(fromPlain(''), 'BY HANDLE kit')
    expect(noFormat(r, 0, 13)).toBe(true)
  })
  it('runs of spaces count as one, and only the phrase is formatted', () => {
    const r = edit(fromPlain(''), 'pipe by   hand x')
    expect(redBold(r, 5, 13)).toBe(true); expect(noFormat(r, 0, 4)).toBe(true); expect(noFormat(r, 14, 16)).toBe(true)
  })
  it('paste: several phrases in one pasted text', () => {
    const r = edit(fromPlain('x'), 'x by hand and by hand')
    expect(redBold(r, 2, 9)).toBe(true); expect(redBold(r, 14, 21)).toBe(true)
  })
  it('idempotent', () => {
    const once = edit(fromPlain(''), 'wire by hand')
    expect(applyAutoRedBold(once, once, cfg)).toBe(once)
    expect(applyAutoRedBold(fromPlain('wire by hand'), once, cfg)).toBe(once) // same text: nothing to do
    const again = edit(once, 'wire by hand ') // a space typed after: still the same formatting
    expect(redBold(again, 5, 12)).toBe(true)
    expect(again).toEqual(applyAutoRedBold(once, applyTextChange(once, 'wire by hand '), cfg))
  })
  it('a manual Clear formatting on the phrase sticks until the phrase is touched again', () => {
    const f = edit(fromPlain(''), 'wire by hand')
    const cleared = clearFormat(f, 5, 12)
    expect(noFormat(cleared, 0, 12)).toBe(true)
    const unrelated = edit(cleared, 'thick wire by hand') // edit far from the phrase span? it touches the start only
    expect(noFormat(unrelated, 11, 18)).toBe(true)
    expect(plain(unrelated)).toBe('thick wire by hand')
    const unrelated2 = edit(cleared, 'wire by hand 5mm')
    expect(noFormat(unrelated2, 5, 12)).toBe(true)
    const retyped = edit(clearFormat(f, 5, 12), 'wire by hanx')
    expect(plain(retyped)).toBe('wire by hanx')
  })
  it('does not rewrite text that was not changed (saved bills are never rewritten on open)', () => {
    const saved = fromPlain('wire by hand')
    expect(applyAutoRedBold(saved, saved, cfg)).toBe(saved)
  })
  it('when: word waits for a space / punctuation; leave waits for the cell to be left', () => {
    const typing = edit(fromPlain('wire by han'), 'wire by hand', cfg, false)
    expect(noFormat(typing, 0, 12)).toBe(true)
    const spaced = edit(fromPlain('wire by hand'), 'wire by hand ', cfg, false)
    expect(redBold(spaced, 5, 12)).toBe(true)
    const comma = edit(fromPlain('wire by hand'), 'wire by hand,', cfg, false)
    expect(redBold(comma, 5, 12)).toBe(true)
    const leaveMode: AutoRedBoldConfig = { ...cfg, when: 'leave' }
    expect(noFormat(edit(fromPlain('wire by hand'), 'wire by hand ', leaveMode, false), 0, 13)).toBe(true)
    expect(redBold(edit(fromPlain(''), 'wire by hand', leaveMode, true), 5, 12)).toBe(true)
    expect(redBold(edit(fromPlain(''), 'wire by hand', cfg, true), 5, 12)).toBe(true) // leaving always applies
  })
  it('off / empty phrase list does nothing; custom phrases work; phrases are matched literally', () => {
    const off = edit(fromPlain(''), 'by hand', { ...cfg, enabled: false })
    expect(noFormat(off, 0, 7)).toBe(true)
    expect(noFormat(edit(fromPlain(''), 'by hand', { ...cfg, phrases: [] }), 0, 7)).toBe(true)
    const custom = edit(fromPlain(''), 'tank IMPORTED here', { ...cfg, phrases: ['imported', 'a.b'] })
    expect(redBold(custom, 5, 13)).toBe(true)
    expect(findPhraseRanges('axb a.b', ['a.b'])).toEqual([{ start: 4, end: 7 }]) // "." is not a wildcard
  })
  it('keeps existing bold / highlight on the rest and does not split an emoji', () => {
    const r = edit(fromPlain('\u{1F600}'), '\u{1F600} by hand')
    expect(plain(r)).toBe('\u{1F600} by hand'); expect(redBold(r, 3, 10)).toBe(true)
  })
  it('works through the grid edit path (applyCellText) and is off without a config', () => {
    const row = { ...createEmptyRow(0) }
    const on = applyCellText(row, { key: 'name', kind: 'text', editable: true, isExtra: false }, 'wire by hand', { autoRedBold: cfg })
    expect(on?.nameRuns && redBold(on.nameRuns, 5, 12)).toBe(true)
    const off = applyCellText(row, { key: 'name', kind: 'text', editable: true, isExtra: false }, 'wire by hand')
    expect(off?.nameRuns && noFormat(off.nameRuns, 0, 12)).toBe(true)
  })
})

describe('autoRedBold settings (Phase 233)', () => {
  it('defaults: ON, ["by hand"], word - in SETTING_DEFAULTS and valid keys', () => {
    expect(AUTO_RED_BOLD_DEFAULTS).toEqual({ 'bill.autoRedBold.enabled': true, 'bill.autoRedBold.phrases': ['by hand'], 'bill.autoRedBold.when': 'word' })
    for (const k of Object.keys(AUTO_RED_BOLD_DEFAULTS)) { expect(SETTING_KEY_RE.test(k)).toBe(true); expect(SETTING_DEFAULTS[k]).toEqual(AUTO_RED_BOLD_DEFAULTS[k]) }
    expect(readAutoRedBold(SETTING_DEFAULTS as Record<string, unknown>)).toEqual({ enabled: true, phrases: ['by hand'], when: 'word' })
    expect(DEFAULT_AUTO_RED_BOLD).toEqual({ enabled: true, phrases: ['by hand'], when: 'word' })
  })
  it('tolerant read: bad values fall back; only a real false turns it off', () => {
    expect(readAutoRedBold({ 'bill.autoRedBold.enabled': 'no', 'bill.autoRedBold.phrases': 5, 'bill.autoRedBold.when': 'x' })).toEqual({ enabled: true, phrases: ['by hand'], when: 'word' })
    expect(readAutoRedBold({ 'bill.autoRedBold.enabled': false, 'bill.autoRedBold.when': 'leave' })).toMatchObject({ enabled: false, when: 'leave' })
    expect(readAutoRedBold({ 'bill.autoRedBold.phrases': [] }).phrases).toEqual([])
  })
  it('phrase list cleaning: trims, collapses spaces, drops blanks and duplicates, caps', () => {
    expect(normalizePhrases(['  By   Hand ', 'by hand', '', 3, 'imported'])).toEqual(['By Hand', 'imported'])
    expect(parsePhraseList('by hand, imported,\n, damaged')).toEqual(['by hand', 'imported', 'damaged'])
    expect(normalizePhrases(Array.from({ length: 40 }, (_, i) => `p${i}`))).toHaveLength(20)
    expect(normalizePhrases(['x'.repeat(100)])[0]).toHaveLength(60)
  })
})
