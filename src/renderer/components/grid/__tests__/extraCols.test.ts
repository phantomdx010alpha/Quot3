// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillGrid } from '../BillGrid'
import { BottomBar } from '../../create/BottomBar'
import { ExtraColsToolbar } from '../../create/ExtraColsToolbar'
import { useHotkeys } from '../../../hooks/useHotkeys'
import { useAppActions } from '../../../hooks/useAppActions'
import { useBillStore } from '../../../stores/billStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { useUndoUiStore } from '../../../stores/undoUiStore'
import { useExtraColUiStore } from '../../../stores/extraColUiStore'
import { historyHooks } from '../../../stores/historyHooks'
import { switchFormat } from '../../../stores/formatActions'
import { extraColCount } from '@shared/extraCols'
import { legacyGridBill } from '@shared/__fixtures__/gridBills'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let clock = 0
const S = () => useBillStore.getState()

function Shell(): React.JSX.Element {
  const actions = useAppActions()
  useHotkeys([], actions)
  return createElement('div', null, createElement(ExtraColsToolbar), createElement(BillGrid), createElement(BottomBar))
}
beforeEach(() => {
  clock = 9_000_000
  historyHooks.now = () => clock
  useGridUiStore.setState({ mode: 'idle', armed: false, notice: '' })
  useUndoUiStore.setState({ panelOpen: false, revertOpen: false })
  useExtraColUiStore.setState({ renameKey: null, removeKey: null })
  act(() => { S().loadBill(legacyGridBill()) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(createElement(Shell)) })
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = '' })

function key(k: string, m: Partial<KeyboardEventInit> = {}, target?: Element): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { (target ?? document.activeElement ?? document.body).dispatchEvent(ev) })
  return ev
}
const headers = () => [...host.querySelectorAll('[role=columnheader]')].map((h) => h.textContent)
const extraHeaders = () => S().extraCols.map((c) => c.header)
const text = (rowId: string, k: string) => S().rows.find((r) => r.id === rowId)?.extras[k]?.text

describe('Phase 21 — extra columns add / remove / rename', () => {
  it('Ctrl+Alt+= appends "Col N" after the existing extras, as one undoable entry; undo removes it', () => {
    const before = extraHeaders()
    const e = key('=', { ctrlKey: true, altKey: true }, document.body)
    expect(e.defaultPrevented).toBe(true)
    expect(extraHeaders()).toEqual([...before, 'Col 1'])
    expect(headers().slice(-1)).toEqual(['Col 1'])
    expect(S().undoLabel).toBe("Added column 'Col 1'")
    act(() => { S().undo() })
    expect(extraHeaders()).toEqual(before)
  })

  it('the toolbar + button adds a column; extraColCount is exposed for the paper engine', () => {
    const n = extraColCount(S().extraCols)
    act(() => { (host.querySelector('[aria-label="Add extra column"]') as HTMLButtonElement).click() })
    expect(extraColCount(S().extraCols)).toBe(n + 1)
  })

  it('removing an EMPTY column needs no confirmation; one with data asks, then Remove deletes header + cells', () => {
    act(() => { S().addExtraCol() })
    const empty = S().extraCols[S().extraCols.length - 1]!.key
    key('-', { ctrlKey: true, altKey: true }, document.body) // targets the last extra column (no active cell)
    expect(S().extraCols.some((c) => c.key === empty)).toBe(false)
    expect(useExtraColUiStore.getState().removeKey).toBeNull()

    const ruby = S().extraCols[0]!
    const id = S().rows.find((r) => (r.extras[ruby.key]?.text ?? '') !== '')!.id
    act(() => { useExtraColUiStore.getState().askRemove(ruby.key) })
    expect(document.body.textContent).toContain(`Remove column '${ruby.header}'?`)
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Remove')!
    act(() => { btn.click() })
    expect(S().extraCols.some((c) => c.key === ruby.key)).toBe(false)
    expect(S().rows.every((r) => !(ruby.key in r.extras))).toBe(true)
    expect(S().undoLabel).toBe(`Removed column '${ruby.header}'`)
    expect(id).toBeTruthy()
  })

  it('remove + undo restores header, position and every cell (incl. marks); redo removes again', () => {
    const ruby = S().extraCols[0]!
    const snapRows = JSON.stringify(S().rows)
    const snapCols = JSON.stringify(S().extraCols)
    act(() => { S().removeExtraCol(ruby.key) })
    expect(S().extraCols.map((c) => c.key)).not.toContain(ruby.key)
    act(() => { S().undo() })
    expect(JSON.stringify(S().extraCols)).toBe(snapCols)
    expect(JSON.stringify(S().rows.filter((r) => r.extras[ruby.key]).map((r) => r.extras[ruby.key]))).toBe(
      JSON.stringify(JSON.parse(snapRows).filter((r: { extras: Record<string, unknown> }) => r.extras[ruby.key]).map((r: { extras: Record<string, unknown> }) => r.extras[ruby.key])))
    expect(S().dirty).toBe(false) // back at the saved state
    act(() => { S().redo() })
    expect(S().extraCols.map((c) => c.key)).not.toContain(ruby.key)
  })

  it('a format switch keeps extra columns and their data (A4)', () => {
    const cols = JSON.stringify(S().extraCols); const rows = JSON.stringify(S().rows)
    act(() => { switchFormat('gst') })
    expect(JSON.stringify(S().extraCols)).toBe(cols)
    expect(headers().slice(-S().extraCols.length)).toEqual(extraHeaders())
    act(() => { switchFormat('non_gst') })
    expect(JSON.stringify(S().rows)).toBe(rows)
  })

  it('rename: double-click opens a single-line editor; Enter commits one undoable entry; Esc cancels; blank keeps the old header', () => {
    const c = S().extraCols[0]!
    const hdr = () => host.querySelector<HTMLElement>(`[role=columnheader][data-col="${c.key}"]`)!
    act(() => { hdr().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    let input = hdr().querySelector<HTMLInputElement>('.q3-gh__input')!
    expect(input).toBeTruthy()
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe(c.header)
    act(() => { input.value = 'a very long header name that must stay one line and be capped' ; input.dispatchEvent(new Event('input', { bubbles: true })) })
    key('Enter', {}, input)
    expect(hdr().querySelector('.q3-gh__input')).toBeNull()
    expect(S().extraCols[0]!.header.length).toBeLessThanOrEqual(40)
    expect(S().extraCols[0]!.header.startsWith('a very long header')).toBe(true)
    expect(S().undoLabel).toContain('Renamed column')
    act(() => { S().undo() })
    expect(S().extraCols[0]!.header).toBe(c.header)

    act(() => { hdr().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    input = hdr().querySelector<HTMLInputElement>('.q3-gh__input')!
    act(() => { input.value = 'zzz' })
    key('Escape', {}, input)
    expect(S().extraCols[0]!.header).toBe(c.header)

    act(() => { hdr().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    input = hdr().querySelector<HTMLInputElement>('.q3-gh__input')!
    act(() => { input.value = '   ' })
    key('Enter', {}, input)
    expect(S().extraCols[0]!.header).toBe(c.header)
  })

  it('typing in the header editor never reaches the grid controller (no cell edit, no consumed keys)', () => {
    const c = S().extraCols[0]!
    act(() => { host.querySelector<HTMLElement>('[role=grid]')!.focus() })
    act(() => { useExtraColUiStore.getState().startRename(c.key) })
    const input = host.querySelector<HTMLInputElement>('.q3-gh__input')!
    const ev = key('ArrowDown', {}, input)
    expect(ev.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(input)
  })

  it('Ctrl+Alt+R starts renaming the last extra column', () => {
    key('r', { ctrlKey: true, altKey: true }, document.body)
    expect(useExtraColUiStore.getState().renameKey).toBe(S().extraCols[S().extraCols.length - 1]!.key)
    expect(host.querySelector('.q3-gh__input')).toBeTruthy()
  })

  it('cell data typed into an added column is stored and shown; text survives rename', () => {
    let k: string | null = null
    act(() => { k = S().addExtraCol() })
    const id = S().view.bodyIds[0]!
    act(() => { S().setCellText(id, k!, '125-5') })
    expect(text(id, k!)).toBe('125-5')
    act(() => { S().renameExtraCol(k!, 'ameto') })
    expect(text(id, k!)).toBe('125-5')
    expect(headers().slice(-1)).toEqual(['ameto'])
  })
})
