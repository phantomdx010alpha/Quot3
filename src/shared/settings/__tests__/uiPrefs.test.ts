import { describe, expect, it } from 'vitest'
import { readUiPrefs, uiPrefTokens, validateUiPrefs } from '../uiPrefs'
import { searchShortcutRows, shortcutRows } from '../../shortcutList'

describe('uiPrefs (Phase 49)', () => {
  it('accepts values inside the clamp ranges and null', () => {
    expect(validateUiPrefs({ rowHeight: 26, gridFontSize: null })).toEqual({ ok: true, value: { rowHeight: 26, gridFontSize: null } })
    expect(validateUiPrefs({ rowHeight: 22, gridFontSize: 16 }).ok).toBe(true)
  })
  it('refuses out-of-range, fractional and non-numeric values with the field named', () => {
    expect(validateUiPrefs({ rowHeight: 21, gridFontSize: null })).toMatchObject({ ok: false, field: 'rowHeight' })
    expect(validateUiPrefs({ rowHeight: 26, gridFontSize: 17 })).toMatchObject({ ok: false, field: 'gridFontSize' })
    expect(validateUiPrefs({ rowHeight: 26.5, gridFontSize: null }).ok).toBe(false)
    expect(validateUiPrefs({ rowHeight: 'x', gridFontSize: null }).ok).toBe(false)
  })
  it('stored garbage reads as "no preference"', () => {
    expect(readUiPrefs({ rowHeight: 99, gridFontSize: 'a' })).toEqual({ rowHeight: null, gridFontSize: null })
    expect(readUiPrefs({ rowHeight: 24, gridFontSize: 14 })).toEqual({ rowHeight: 24, gridFontSize: 14 })
  })
  it('tokens only for the preferences that are set', () => {
    expect(uiPrefTokens({ rowHeight: 24, gridFontSize: null })).toEqual({ '--row-height': '24px' })
    expect(uiPrefTokens({ rowHeight: null, gridFontSize: null })).toEqual({})
  })
})

describe('shortcut viewer rows (Phase 49)', () => {
  const rows = shortcutRows()
  it('lists every action once, including palette-only ones', () => {
    expect(new Set(rows.map((r) => r.action)).size).toBe(rows.length)
    expect(rows.some((r) => r.bindings.length === 0)).toBe(true)
  })
  it('search ANDs words across label, keys and scope', () => {
    expect(searchShortcutRows(rows, 'themes').some((r) => r.action === 'settings.themes')).toBe(true)
    expect(searchShortcutRows(rows, '').length).toBe(rows.length)
    expect(searchShortcutRows(rows, 'zzzqq')).toEqual([])
  })
})
