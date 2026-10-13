// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BillGrid } from '../BillGrid'
import { CLIPBOARD_FALLBACK_MS } from '../gridController'
import { useBillStore } from '../../../stores/billStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { historyHooks } from '../../../stores/historyHooks'
import { legacyGridBill } from '@shared/__fixtures__/gridBills'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
type W = { quot3?: unknown }
const win = window as unknown as W

beforeEach(() => {
  vi.useFakeTimers()
  useGridUiStore.setState({ mode: 'idle', armed: false, notice: '' })
  act(() => { useBillStore.getState().loadBill(legacyGridBill()) })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(createElement(BillGrid)) })
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); historyHooks.wrap = (_l, fn) => fn()
  delete win.quot3; vi.useRealTimers()
})

const grid = () => host.querySelector<HTMLElement>('[role=grid]')!
const inRange = () => host.querySelectorAll('[data-in-range]').length
const stored = (i: number) => useBillStore.getState().rows[i]!
const nameOf = (i: number) => stored(i).nameRuns.map((r) => r.t).join('')
function key(k: string, m: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { (document.activeElement ?? grid()).dispatchEvent(ev) })
  return ev
}
const wait = async (ms = CLIPBOARD_FALLBACK_MS + 5): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
function selectRange(): void {
  act(() => { grid().focus() })
  key('ArrowDown', { shiftKey: true })
}

describe('Phase 119 - bare modifier keys', () => {
  it('Ctrl / Shift / Alt / Meta alone keep the range, the focus and the active cell', () => {
    selectRange()
    const n = inRange(); const focused = document.activeElement
    expect(n).toBe(2)
    for (const [k, m] of [['Control', { ctrlKey: true }], ['Shift', { shiftKey: true }], ['Alt', { altKey: true }], ['Meta', { metaKey: true }]] as const) {
      key(k, m)
      expect(inRange()).toBe(n)
      expect(document.activeElement).toBe(focused)
    }
  })
})

describe('Phase 119 - Ctrl+C / Ctrl+X fallback through the bridge', () => {
  it('copy: when no native copy event arrives, the range TSV is written with clipboard:writeTsv', async () => {
    const writeTsv = vi.fn(async () => ({ ok: true as const, data: {} }))
    win.quot3 = { clipboard: { writeTsv } }
    selectRange()
    key('Control', { ctrlKey: true })
    key('c', { ctrlKey: true })
    expect(writeTsv).not.toHaveBeenCalled() // the native event gets its chance first
    await wait()
    expect(writeTsv).toHaveBeenCalledTimes(1)
    const text = (writeTsv.mock.calls[0] as unknown as [{ text: string }])[0].text
    expect(text.split('\r\n')[0]).toBe(nameOf(0))
    expect(inRange()).toBe(2) // copy keeps the range
  })

  it('copy: when the native event DID arrive the fallback does nothing (no double write)', async () => {
    const writeTsv = vi.fn(async () => ({ ok: true as const, data: {} }))
    win.quot3 = { clipboard: { writeTsv } }
    selectRange()
    key('c', { ctrlKey: true })
    const ev = new Event('copy', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
    ev.clipboardData = { getData: () => '', setData: () => undefined }
    act(() => { (document.activeElement ?? grid()).dispatchEvent(ev) })
    await wait()
    expect(writeTsv).not.toHaveBeenCalled()
  })

  it('cut: the fallback writes the TSV and then clears the range in one step', async () => {
    const writeTsv = vi.fn(async () => ({ ok: true as const, data: {} }))
    win.quot3 = { clipboard: { writeTsv } }
    selectRange()
    const first = nameOf(0)
    expect(first).not.toBe('')
    key('x', { ctrlKey: true })
    await wait()
    expect(writeTsv).toHaveBeenCalledTimes(1)
    expect(nameOf(0)).toBe('')
  })

  it('Free mode with no range stays native text copy: no fallback write', async () => {
    const writeTsv = vi.fn(async () => ({ ok: true as const, data: {} }))
    win.quot3 = { clipboard: { writeTsv } }
    act(() => { grid().focus() })
    key('F2')
    key('c', { ctrlKey: true })
    await wait()
    expect(writeTsv).not.toHaveBeenCalled()
  })

  it('a failed clipboard write is reported and the cut does NOT clear anything', async () => {
    const writeTsv = vi.fn(async () => ({ ok: false as const, error: { code: 'X', message: 'locked' } }))
    win.quot3 = { clipboard: { writeTsv } }
    selectRange()
    const first = nameOf(0)
    key('x', { ctrlKey: true })
    await wait()
    expect(nameOf(0)).toBe(first)
    expect(useGridUiStore.getState().notice).toContain('clipboard')
  })
})

describe('Phase 119 - Ctrl+V fallback through the bridge', () => {
  it('paste: when no native paste event arrives, clipboard:readGrid TSV flows into rows from the active cell', async () => {
    const readGrid = vi.fn(async () => ({ ok: true as const, data: { tsv: 'P1\t10\t2\r\nP2\t20\t3\r\n' } }))
    win.quot3 = { clipboard: { readGrid } }
    act(() => { grid().focus() })
    key('Control', { ctrlKey: true })
    key('v', { ctrlKey: true })
    expect(readGrid).not.toHaveBeenCalled()
    await wait()
    expect(readGrid).toHaveBeenCalledTimes(1)
    expect([nameOf(0), stored(0).rate, stored(0).qty, nameOf(1), stored(1).rate]).toEqual(['P1', '10', '2', 'P2', '20'])
  })

  it('paste: when the native paste event arrived, the fallback does not paste a second time', async () => {
    const readGrid = vi.fn(async () => ({ ok: true as const, data: { tsv: 'Q1\t1\r\n' } }))
    win.quot3 = { clipboard: { readGrid } }
    act(() => { grid().focus() })
    key('v', { ctrlKey: true })
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
    ev.clipboardData = { getData: (t: string) => (t === 'text/plain' ? 'Q1\t1\r\nQ2\t2\r\n' : ''), setData: () => undefined }
    act(() => { (document.activeElement ?? grid()).dispatchEvent(ev) })
    await wait()
    expect(readGrid).not.toHaveBeenCalled()
    expect([nameOf(0), nameOf(1)]).toEqual(['Q1', 'Q2'])
  })

  it('paste onto a selected range works through the fallback too', async () => {
    const readGrid = vi.fn(async () => ({ ok: true as const, data: { tsv: 'Z\r\nY\r\n' } }))
    win.quot3 = { clipboard: { readGrid } }
    selectRange()
    key('v', { ctrlKey: true })
    await wait()
    expect([nameOf(0), nameOf(1)]).toEqual(['Z', 'Y'])
  })

  it('copy via the fallback then paste via the fallback keeps item-name formatting (in-memory flavour)', async () => {
    let clip = ''
    const writeTsv = vi.fn(async (i: { text: string }) => { clip = i.text; return { ok: true as const, data: {} } })
    const readGrid = vi.fn(async () => ({ ok: true as const, data: { tsv: clip } }))
    win.quot3 = { clipboard: { writeTsv, readGrid } }
    act(() => { useBillStore.getState().setCellTexts([{ rowId: stored(0).id, colKey: 'name', text: 'Hot dog', runs: [{ t: 'Hot ', r: 1, b: 1 }, { t: 'dog' }] }]) })
    act(() => { grid().focus() })
    key('c', { ctrlKey: true }); await wait()
    expect(writeTsv).toHaveBeenCalledTimes(1)
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown')
    key('v', { ctrlKey: true }); await wait()
    const target = useBillStore.getState().rows.find((r, i) => i > 0 && r.nameRuns.map((x) => x.t).join('') === 'Hot dog')
    expect(target?.nameRuns).toEqual([{ t: 'Hot ', r: 1, b: 1 }, { t: 'dog' }])
  })
})
