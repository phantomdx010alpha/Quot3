import { afterEach, describe, expect, it } from 'vitest'
import { remapColumnKey } from '../gridModel'
import { registerFormat, unregisterFormat, getFormat } from '../format/registry'
import {
  allActions, allShortcuts, findShortcutConflicts, formatActionDefs, formatActionId, formatShortcutDefs, matchShortcut, primaryKeys
} from '../shortcuts'
import { NON_GST_FORMAT } from '../format/nonGst'

const GST = ['slNo', 'name', 'qty', 'rate', 'total', 'gstRate', 'gstAmt', 'amount']
const GST_NAV = ['name', 'qty', 'rate', 'total', 'gstRate']
const PLAIN = ['slNo', 'name', 'qty', 'rate', 'total']
const PLAIN_NAV = ['name', 'qty', 'rate', 'total']
const ev = (key: string, m: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) =>
  ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...m })

describe('Phase 20 — remapColumnKey', () => {
  it('keeps the same logical column when it exists in the new layout', () => {
    expect(remapColumnKey(PLAIN, GST_NAV, 'rate')).toBe('rate')
    expect(remapColumnKey(GST, PLAIN_NAV, 'total')).toBe('total')
    expect(remapColumnKey(GST, PLAIN_NAV, 'name')).toBe('name')
  })
  it('falls back to the nearest surviving column along the old order', () => {
    expect(remapColumnKey(GST, PLAIN_NAV, 'gstRate')).toBe('total') // GST % → Total
    expect(remapColumnKey(GST, PLAIN_NAV, 'gstAmt')).toBe('total')
    expect(remapColumnKey(GST, PLAIN_NAV, 'amount')).toBe('total')
  })
  it('extra columns survive format switches and stay put', () => {
    expect(remapColumnKey([...GST, 'x1'], [...PLAIN_NAV, 'x1'], 'x1')).toBe('x1')
  })
  it('unknown key → first column; nowhere to go → null', () => {
    expect(remapColumnKey(GST, PLAIN_NAV, 'zzz')).toBe('name')
    expect(remapColumnKey(GST, [], 'rate')).toBeNull()
  })
})

describe('Phase 20 — format actions and shortcuts come from the registry', () => {
  afterEach(() => { unregisterFormat('third_fmt') })

  it('Alt+1 → GST and Alt+2 → Non-GST, global scope, no conflicts', () => {
    expect(matchShortcut(ev('1', { altKey: true }))?.action).toBe('format.set.gst')
    expect(matchShortcut(ev('2', { altKey: true }))?.action).toBe('format.set.non_gst')
    expect(matchShortcut(ev('1', { altKey: true }), ['grid'])?.action).toBe('format.set.gst')
    expect(primaryKeys(formatActionId('gst'))).toBe('Alt+1')
    expect(findShortcutConflicts()).toEqual([])
  })
  it('every registered format has a palette action and every format shortcut maps to a registered action', () => {
    const ids = new Set(allActions().map((a) => a.id))
    expect(formatActionDefs().map((a) => a.label)).toEqual(['Switch to Non-GST', 'Switch to GST'])
    for (const s of formatShortcutDefs()) expect(ids.has(s.action)).toBe(true)
    for (const s of allShortcuts()) expect(ids.has(s.action)).toBe(true)
    expect(new Set(allActions().map((a) => a.id)).size).toBe(allActions().length)
  })
  it('a newly registered format appears in the palette and gets its key — no other code changes', () => {
    registerFormat({ ...NON_GST_FORMAT, id: 'third_fmt', label: 'Third', shortcut: 'Alt+3', isDefault: false })
    expect(allActions().some((a) => a.id === 'format.set.third_fmt' && a.label === 'Switch to Third')).toBe(true)
    expect(matchShortcut(ev('3', { altKey: true }))?.action).toBe('format.set.third_fmt')
    expect(findShortcutConflicts()).toEqual([])
    expect(getFormat('third_fmt').label).toBe('Third')
    unregisterFormat('third_fmt')
    expect(allActions().some((a) => a.id === 'format.set.third_fmt')).toBe(false)
    expect(matchShortcut(ev('3', { altKey: true }))).toBeNull()
  })
})
