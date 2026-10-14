// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Create from '../../../pages/Create'
import { useBillStore } from '../../../stores/billStore'
import { createSession } from '../../../stores/createSession'
import { enterHybrid, focusHybridTable, requestRecopy, useHybridUiStore } from '../../../stores/hybridActions'
import { switchFormat } from '../../../stores/formatActions'
import { createEmptyBill } from '@shared/billModel'
import { buildDraftPayload, parseDraftPayload } from '@shared/draft'
import { validateBillForSave } from '@shared/billSave'
import type { BillRow } from '@shared/types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const row = (id: string, name: string, qty: string | null, rate: string | null, extra: Partial<BillRow> = {}): BillRow =>
  ({ id, idx: 0, nameRuns: name ? [{ t: name }] : [], qty, rate, totalOverride: null, gstRate: null, extras: {}, ...extra })

let host: HTMLDivElement
let root: Root

function openGstBill(): void {
  const b = createEmptyBill({ branchId: 'br1', formatId: 'gst', rowCount: 0 })
  const bill = {
    ...b,
    party: { ...b.party, name: 'Test Party' },
    extraCols: [{ key: 'c1', header: 'Units', kind: 'units' as const }],
    rows: [row('p1', 'Pipe', '2', '50', { gstRate: '18', extras: { c1: { text: '5 box' } } }), row('p2', 'Elbow', '3', '10', { gstRate: '12' })].map((r, i) => ({ ...r, idx: i }))
  }
  createSession.set(bill.id)
  useBillStore.getState().loadBill(bill)
}
const grids = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[role=grid]')]
const panes = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('.q3-hy-pane')]
const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[role=dialog]')

beforeEach(() => {
  useBillStore.setState({ billId: null })
  createSession.set(null)
  useHybridUiStore.setState({ recopyTarget: null })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  openGstBill()
  act(() => root.render(createElement(Create)))
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Phase 151 - Hybrid on the Create page', () => {
  it('outside Hybrid there is ONE grid and no pane titles', () => {
    expect(grids()).toHaveLength(1)
    expect(panes()).toHaveLength(1)
    expect(host.querySelector('.q3-hy-pane__title')).toBeNull()
    expect(host.querySelector('.q3-create__grid')?.getAttribute('data-hybrid')).toBeNull()
  })

  it('Alt+3 shows two titled tables side by side, the GST one first, and the first grid is not remounted', () => {
    const before = grids()[0]!
    act(() => { enterHybrid() })
    expect(panes().map((p) => p.dataset.side)).toEqual(['primary', 'second'])
    expect(panes().map((p) => p.querySelector('.q3-hy-pane__title')?.textContent)).toEqual(['GST', 'Non-GST'])
    expect(grids().map((g) => g.getAttribute('aria-label'))).toEqual(['GST table', 'Non-GST table'])
    expect(grids()[0]).toBe(before)
    expect(host.querySelector('.q3-create__grid')?.getAttribute('data-hybrid')).toBe('on')
  })

  it('the second table starts as a copy of the first one (names and quantities), in the other layout', () => {
    act(() => { enterHybrid() })
    const [left, right] = grids()
    expect(left!.textContent).toContain('Pipe')
    expect(right!.textContent).toContain('Pipe')
    expect(right!.textContent).toContain('Elbow')
    const heads = (g: HTMLElement): string[] => [...g.querySelectorAll('[role=columnheader]')].map((h) => h.textContent ?? '')
    expect(heads(left!).join('|')).toMatch(/GST/)
    expect(heads(right!).join('|')).not.toMatch(/GST/)
  })

  it('a non-GST bill puts the non-GST table first and a GST table second', () => {
    act(() => { switchFormat('non_gst') })
    act(() => { enterHybrid() })
    expect(panes().map((p) => p.querySelector('.q3-hy-pane__title')?.textContent)).toEqual(['Non-GST', 'GST'])
  })

  it('Ctrl+Alt+Left / Right actions put the cursor in the first / second grid', () => {
    act(() => { enterHybrid() })
    act(() => { focusHybridTable('second') })
    expect(document.activeElement?.closest('.q3-hy-pane')?.getAttribute('data-side')).toBe('second')
    act(() => { focusHybridTable('primary') })
    expect(document.activeElement?.closest('.q3-hy-pane')?.getAttribute('data-side')).toBe('primary')
  })

  it('without a second table the table-switch action only reports and moves nothing', () => {
    expect(focusHybridTable('second')).toBe(false)
  })

  it('Alt+1 / Alt+2 leave the Hybrid view (one grid again) and the second table is kept', () => {
    act(() => { enterHybrid() })
    act(() => { switchFormat('non_gst') })
    expect(grids()).toHaveLength(1)
    const s = useBillStore.getState()
    expect(s.hybrid?.active).toBe(false)
    expect(s.hybrid?.rows.length).toBeGreaterThan(0)
    act(() => { enterHybrid() })
    expect(grids()).toHaveLength(2)
  })

  it('re-copy asks first; Cancel changes nothing, Re-copy replaces the table the cursor is in', () => {
    act(() => { enterHybrid() })
    act(() => { useBillStore.getState().setSecondCellTexts([{ rowId: useBillStore.getState().hybrid!.rows[0]!.id, colKey: 'name', text: 'Changed' }]) })
    expect(grids()[1]!.textContent).toContain('Changed')
    act(() => { focusHybridTable('second') })
    act(() => { requestRecopy() })
    expect(dialog()?.textContent).toMatch(/Re-copy the Non-GST table/)
    const btn = (label: string): HTMLButtonElement => [...dialog()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!
    act(() => { btn('Cancel').click() })
    expect(dialog()).toBeNull()
    expect(grids()[1]!.textContent).toContain('Changed')
    act(() => { requestRecopy() })
    act(() => { btn('Re-copy').click() })
    expect(dialog()).toBeNull()
    expect(grids()[1]!.textContent).not.toContain('Changed')
    expect(grids()[1]!.textContent).toContain('Pipe')
    expect(grids()[0]!.textContent).not.toContain('Changed')
  })

  it('undo of the switch goes back to one grid', () => {
    act(() => { enterHybrid() })
    expect(grids()).toHaveLength(2)
    act(() => { useBillStore.getState().undo() })
    expect(grids()).toHaveLength(1)
  })
})

describe('Phase 151 - drafts, dirty state and save checks carry the second table', () => {
  it('entering Hybrid makes the bill dirty', () => {
    expect(useBillStore.getState().dirty).toBe(false)
    act(() => { enterHybrid() })
    expect(useBillStore.getState().dirty).toBe(true)
  })

  it('a draft round trip keeps the second table, the active flag and the shared-extra pairing', () => {
    act(() => { enterHybrid() })
    const bill = useBillStore.getState().toBill()
    const parsed = parseDraftPayload(JSON.stringify(buildDraftPayload(bill)))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.bill.hybrid?.active).toBe(true)
    expect(parsed.bill.hybrid?.primary).toBe('gst')
    expect(parsed.bill.hybrid?.rows.map((r) => r.nameRuns.map((x) => x.t).join('')).filter(Boolean)).toEqual(['Pipe', 'Elbow'])
    expect(parsed.bill.hybrid?.twins).toEqual(bill.hybrid?.twins)
  })

  it('recovering a draft shows the two tables again', () => {
    act(() => { enterHybrid() })
    const parsed = parseDraftPayload(JSON.stringify(buildDraftPayload(useBillStore.getState().toBill())))
    if (!parsed.ok) throw new Error('draft not readable')
    act(() => { useBillStore.getState().loadBill({ ...parsed.bill, hybrid: undefined }) })
    expect(grids()).toHaveLength(1) // a bill without a second table: one grid
    act(() => { useBillStore.getState().loadDraft(parsed.bill, { ...parsed.bill, hybrid: undefined }) })
    expect(grids()).toHaveLength(2)
  })

  it('save validation checks the primary table only and passes for a normal Hybrid bill', () => {
    act(() => { enterHybrid() })
    expect(validateBillForSave(useBillStore.getState().toBill())).toBeNull()
  })
})
