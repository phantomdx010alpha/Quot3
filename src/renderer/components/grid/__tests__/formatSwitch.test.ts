// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillGrid } from '../BillGrid'
import { BottomBar } from '../../create/BottomBar'
import { FormatSwitcher } from '../../create/FormatSwitcher'
import { CommandPalette } from '../../layout/CommandPalette'
import { useHotkeys } from '../../../hooks/useHotkeys'
import { useAppActions } from '../../../hooks/useAppActions'
import { useBillStore } from '../../../stores/billStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { useUndoUiStore } from '../../../stores/undoUiStore'
import { historyHooks } from '../../../stores/historyHooks'
import { legacyGridBill } from '@shared/__fixtures__/gridBills'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let clock = 0
const S = () => useBillStore.getState()

function Shell({ palette = false }: { palette?: boolean }): React.JSX.Element {
  const actions = useAppActions()
  useHotkeys([], actions)
  return createElement('div', null, createElement(FormatSwitcher), createElement(BillGrid), createElement(BottomBar),
    palette ? createElement(CommandPalette, { open: true, onClose: () => undefined, onRun: (id) => actions[id]?.() }) : null)
}
function mount(palette = false): void {
  act(() => { S().loadBill(legacyGridBill()) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(createElement(Shell, { palette })) })
}
beforeEach(() => {
  ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => undefined // jsdom lacks it (palette list)
  clock = 9_000_000
  historyHooks.now = () => clock
  useGridUiStore.setState({ mode: 'idle', armed: false, notice: '' })
  useUndoUiStore.setState({ panelOpen: false, revertOpen: false })
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = '' })

const grid = () => host.querySelector<HTMLElement>('[role=grid]')!
function key(k: string, m: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { (document.activeElement ?? document.body).dispatchEvent(ev) })
  return ev
}
const alt = (n: string) => key(n, { altKey: true })
const headers = () => [...host.querySelectorAll('[role=columnheader]')].map((h) => h.textContent) // legacy fixture also has extra columns after these
const PLAIN = ['Sl.No', 'Item Name', 'Rate', 'Quantity', 'Amount']
const GST = ['Sl.No', 'Item Name', 'Quantity', 'Rate', 'Total', 'GST %', 'GST Amt', 'Amount']
const activeCol = () => document.activeElement?.closest<HTMLElement>('.q3-gc')?.dataset.col
const rowsJson = () => JSON.stringify(S().rows)
const bodyRow = (i: number) => S().view.bodyIds[i]!
const txt = (rowId: string, col: string) => S().view.body[rowId]?.cells[col]

describe('Phase 20 — switching format (Alt+1 / Alt+2)', () => {
  it('Alt+1 shows the GST columns, Alt+2 the plain ones; rows are byte-identical both ways', () => {
    mount()
    const before = rowsJson(); const rowsRef = S().rows
    act(() => { grid().focus() })
    const extraCount = headers().length - PLAIN.length
    expect(S().formatId).toBe('non_gst')
    expect(headers().slice(0, PLAIN.length)).toEqual(PLAIN)
    const e = alt('1')
    expect(e.defaultPrevented).toBe(true)
    expect(S().formatId).toBe('gst')
    expect(headers().slice(0, GST.length)).toEqual(GST)
    expect(headers().length - GST.length).toBe(extraCount) // extra columns stay, after the format's own
    expect(S().rows).toBe(rowsRef) // not even a new array: no row was touched
    alt('2')
    expect(S().formatId).toBe('non_gst')
    expect(headers().slice(0, PLAIN.length)).toEqual(PLAIN)
    expect(rowsJson()).toBe(before)
  })

  it('entered data survives GST → non-GST → GST (GST % too) and GST math follows the format', () => {
    mount()
    act(() => { grid().focus() })
    alt('1')
    const id = bodyRow(0)
    act(() => { S().setCellText(id, 'gstRate', '18') })
    const total = txt(id, 'total')!
    expect(total).toMatch(/^\d/)
    expect(txt(id, 'gstAmt')).toBeDefined()
    const gstAmt = txt(id, 'gstAmt'); const amount = txt(id, 'amount')
    alt('2')
    expect(S().rows.find((r) => r.id === id)?.gstRate).toBe('18')
    expect(txt(id, 'total')).toBe(total)
    alt('1')
    expect(txt(id, 'gstAmt')).toBe(gstAmt)
    expect(txt(id, 'amount')).toBe(amount)
    expect(host.querySelector(`[data-row-id="${id}"] [data-col="gstRate"]`)?.textContent).toBe('18')
  })

  it('GST math: qty 2 × rate 100 at 18 % → total 200.00, GST 36.00, amount 236.00', () => {
    mount()
    const id = bodyRow(0)
    act(() => { S().setFormatId('gst') }) // GST % is a GST-format column: it can only be edited while that format is shown
    act(() => { S().setCellText(id, 'qty', '2'); S().setCellText(id, 'rate', '100'); S().setCellText(id, 'gstRate', '18'); S().setCellText(id, 'total', '') })
    expect(txt(id, 'total')).toBe('200.00')
    expect(txt(id, 'gstAmt')).toBe('36.00')
    expect(txt(id, 'amount')).toBe('236.00')
  })

  it('GST footer: one Total row carrying total, GST amount and amount; plain footer has no GST cells; the item total is the same in both', () => {
    mount()
    act(() => { S().setFormatId('gst') })
    for (const i of [0, 1, 2]) act(() => { S().setCellText(bodyRow(i), 'gstRate', '18') })
    const g = S().view.footer.find((d) => d.kind === 'grandTotal')!
    expect(g.cells.total).toBe('17226.00')
    expect(g.cells.gstAmt).toBe('961.20')
    expect(g.cells.amount).toBe('18187.20')
    expect(host.querySelector('.q3-grid')?.textContent).toContain('18187.20')
    act(() => { S().setFormatId('non_gst') })
    const p = S().view.footer.find((d) => d.kind === 'grandTotal')!
    expect(p.cells.total).toBe('17226.00')
    expect(p.cells.gstAmt ?? '').toBe('')
    expect(host.querySelector('.q3-grid')?.textContent).not.toContain('18187.20')
  })

  it('is one undoable entry named after the format; undo and redo restore the format only', () => {
    mount()
    act(() => { grid().focus() })
    alt('1')
    expect(S().undoLabel).toBe('Switched to GST')
    const rows = S().rows
    key('z', { ctrlKey: true })
    expect(S().formatId).toBe('non_gst')
    expect(S().rows).toBe(rows)
    key('y', { ctrlKey: true })
    expect(S().formatId).toBe('gst')
  })

  it('pressing the key of the format already active does nothing (no history entry)', () => {
    mount()
    act(() => { grid().focus() })
    alt('2')
    expect(S().canUndo).toBe(false)
    alt('1'); alt('1')
    expect(S().historyList().length).toBe(1)
  })

  it('a typed-but-uncommitted draft is committed first, so nothing is lost and undo goes switch → typing', () => {
    mount()
    act(() => { grid().focus() })
    const id = S().view.navIds[0]!
    const before = S().rows.find((r) => r.id === id)!.nameRuns.map((r) => r.t).join('')
    for (const ch of 'ZZ') key(ch)
    alt('1')
    expect(S().rows.find((r) => r.id === id)!.nameRuns.map((r) => r.t).join('')).toBe(before + 'ZZ')
    expect(S().undoLabel).toBe('Switched to GST')
    key('z', { ctrlKey: true })
    expect(S().formatId).toBe('non_gst')
    expect(S().rows.find((r) => r.id === id)!.nameRuns.map((r) => r.t).join('')).toBe(before + 'ZZ')
    key('z', { ctrlKey: true })
    expect(S().rows.find((r) => r.id === id)!.nameRuns.map((r) => r.t).join('')).toBe(before)
  })
})

describe('Phase 20 — the active cell follows the switch', () => {
  it('stays on the same logical column and row (Rate)', () => {
    mount()
    act(() => { grid().focus() })
    key('Tab') // name → rate (non-GST order)
    expect(activeCol()).toBe('rate')
    const rowId = document.activeElement!.closest<HTMLElement>('[data-row-id]')!.dataset.rowId
    alt('1')
    expect(activeCol()).toBe('rate')
    expect(document.activeElement!.closest<HTMLElement>('[data-row-id]')!.dataset.rowId).toBe(rowId)
    expect(useGridUiStore.getState().mode).toBe('append')
  })

  it('a column that disappears (GST %) moves to the nearest one (Total); typing works there afterwards', () => {
    mount()
    act(() => { grid().focus() })
    alt('1')
    for (let i = 0; i < 4; i++) key('Tab') // name → qty → rate → total → GST %
    expect(activeCol()).toBe('gstRate')
    alt('2')
    expect(activeCol()).toBe('total')
    expect(document.activeElement!.getAttribute('contenteditable')).toBe('plaintext-only')
    key('Tab') // moves on normally (the next navigable column after Total is the first extra column)
    expect(activeCol()).toBe(host.querySelectorAll('[role=columnheader]')[5] ? 'ruby' : 'name')
  })

  it('does not pull focus into the grid when it was somewhere else', () => {
    mount()
    act(() => { grid().focus() })
    key('Tab')
    const other = document.createElement('input'); document.body.appendChild(other)
    act(() => { other.focus() })
    alt('1')
    expect(S().formatId).toBe('gst')
    expect(document.activeElement).toBe(other)
  })
})

describe('Phase 20 — switcher and palette', () => {
  const sel = (): HTMLSelectElement => host.querySelector<HTMLSelectElement>('.q3-fmtsw__sel')!
  const pick = (value: string): void => { act(() => { sel().value = value; sel().dispatchEvent(new Event('change', { bubbles: true })) }) }

  it('the switcher is one dropdown listing every registered format, shows the active one, switches on change and keeps the caret', () => {
    mount()
    act(() => { grid().focus() })
    const options = [...sel().options]
    expect(options.length).toBe(4) // GST, Non-GST, Stock transfer (Phase 149) + Hybrid (Phase 151)
    expect(sel().value).toBe('non_gst')
    pick('gst')
    expect(S().formatId).toBe('gst')
    expect(sel().value).toBe('gst')
    expect(document.activeElement?.closest('.q3-grid')).not.toBeNull()
    expect(sel().tabIndex).toBe(-1)
  })

  it('the switcher shows the format shortcut from the registry', () => {
    mount()
    expect(btn(/^GST/).querySelector('.q3-kbds')?.getAttribute('aria-label')).toBe('Alt+1')
    expect(btn(/Non-GST/).querySelector('.q3-kbds')?.getAttribute('aria-label')).toBe('Alt+2')
  })

  it('palette: "switch to gst" is listed and running it switches the format', async () => {
    mount(true)
    const rows = [...document.querySelectorAll('.q3-palette__row')].map((r) => r.textContent ?? '')
    expect(rows.some((t) => t.includes('Switch to GST'))).toBe(true)
    expect(rows.some((t) => t.includes('Switch to Non-GST'))).toBe(true)
    const hint = (label: string) => [...document.querySelectorAll<HTMLElement>('.q3-palette__row')].find((r) => (r.textContent ?? '').includes(label))?.querySelector('.q3-kbds')?.getAttribute('aria-label')
    expect(hint('Switch to GST')).toBe('Alt+1')
    expect(hint('Switch to Non-GST')).toBe('Alt+2')
    const row = [...document.querySelectorAll<HTMLElement>('.q3-palette__row')].find((r) => (r.textContent ?? '').includes('Switch to GST'))!
    await act(async () => { row.click(); await Promise.resolve() }) // the palette runs its action on a microtask
    expect(S().formatId).toBe('gst')
    expect(S().undoLabel).toBe('Switched to GST')
  })
})
