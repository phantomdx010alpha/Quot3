import { describe, expect, it } from 'vitest'
import { PANEL_MAX_ROWS, acceptableName, dateText, noticeText, panelView, panelWanted, rowOf, timesText } from '../aiPanel'
import type { PartySuggestion } from '../partyHistory'

const sug = (over: Partial<PartySuggestion> = {}): PartySuggestion => ({
  nameUsed: 'Ruby Tomato Seeds', formatLabel: 'GST', gst: true, lastRate: '90', lastQty: '12', lastUnit: null, lastDate: '2026-10-03', timesBought: 3,
  tier: 2, score: 0.9, why: 'looks similar', explanation: 'x', ...over
})
const on = { enabled: true, billingPanel: true, partyName: 'Invented Traders', cellActive: true }

describe('Phase 226 panel gate', () => {
  it('needs the master switch, the panel switch, a party and an active item cell', () => {
    expect(panelWanted(on)).toBe(true)
    expect(panelWanted({ ...on, enabled: false })).toBe(false)
    expect(panelWanted({ ...on, billingPanel: false })).toBe(false)
    expect(panelWanted({ ...on, partyName: '   ' })).toBe(false)
    expect(panelWanted({ ...on, cellActive: false })).toBe(false)
  })
})

describe('Phase 226 panel view', () => {
  it('is hidden when off, with no party, or with no cell, even with rows', () => {
    for (const g of [{ ...on, enabled: false }, { ...on, partyName: '' }, { ...on, cellActive: false }])
      expect(panelView(g, 'ready', [sug()])).toEqual({ kind: 'hidden' })
  })
  it('shows the rows (capped) with name, format, rate, qty, date, count and reason', () => {
    const v = panelView(on, 'ready', Array.from({ length: 7 }, (_, i) => sug({ nameUsed: `N${i}` })))
    expect(v.kind).toBe('rows')
    if (v.kind !== 'rows') return
    expect(v.rows).toHaveLength(PANEL_MAX_ROWS)
    expect(v.rows[0]).toMatchObject({ name: 'N0', format: 'GST', gst: true, rate: '90', qty: '12', date: '03/10/2026', times: 'bought 3 times', reason: 'looks similar' })
  })
  it('hides on a ready model with no match; shows a quiet notice only while loading / missing / failed', () => {
    expect(panelView(on, 'ready', [])).toEqual({ kind: 'hidden' })
    expect(panelView(on, null, [])).toEqual({ kind: 'hidden' })
    expect(panelView(on, 'loading', [])).toEqual({ kind: 'notice', text: 'AI is loading' })
    expect(panelView(on, 'notInstalled', [])).toEqual({ kind: 'notice', text: 'AI model is not installed' })
    expect(panelView(on, 'error', [])).toEqual({ kind: 'notice', text: 'AI is not available' })
    expect(noticeText('ready')).toBeNull()
  })
  it('rows win over a notice (tier 1 and 2 work without the model)', () => {
    expect(panelView(on, 'notInstalled', [sug()]).kind).toBe('rows')
  })
  it('keeps rate and qty as the stored text, with a dash for missing values and the unit when there is one', () => {
    expect(rowOf(sug({ lastRate: '1250.50', lastQty: '2.5', lastUnit: 'kg' }), 0)).toMatchObject({ rate: '1250.50', qty: '2.5 kg' })
    expect(rowOf(sug({ lastRate: null, lastQty: null }), 0)).toMatchObject({ rate: '-', qty: '-' })
    expect(rowOf(sug({ gst: false, formatLabel: 'Non-GST' }), 0)).toMatchObject({ gst: false, format: 'Non-GST' })
  })
  it('helpers: day-first date, count wording, the unbuilt accept key only ever offers the NAME', () => {
    expect(dateText('2026-02-09T10:00:00Z')).toBe('09/02/2026')
    expect(dateText('9 Feb')).toBe('9 Feb')
    expect(timesText(1)).toBe('bought once')
    expect(timesText(2)).toBe('bought 2 times')
    expect(acceptableName(rowOf(sug(), 0))).toBe('Ruby Tomato Seeds')
  })
})
