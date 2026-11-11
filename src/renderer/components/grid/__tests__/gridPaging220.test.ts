// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillGrid } from '../BillGrid'
import { useBillStore } from '../../../stores/billStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { historyHooks } from '../../../stores/historyHooks'
import { usePageMemoryStore, resetPageMemoryForTests } from '../../../stores/pageMemoryStore'
import { useRouter } from '../../../router/routerStore'
import { ROUTES, initialNav } from '@shared/routes'
import { legacyGridBill } from '@shared/__fixtures__/gridBills'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  resetPageMemoryForTests()
  useRouter.setState({ nav: initialNav(ROUTES.create) })
  useGridUiStore.setState({ mode: 'idle', armed: false, notice: '' })
  act(() => { useBillStore.getState().loadBill(legacyGridBill()) })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(createElement(BillGrid)) })
})
afterEach(() => { act(() => root.unmount()); host.remove(); historyHooks.wrap = (_l, fn) => fn() })

const grid = () => host.querySelector<HTMLElement>('[role=grid]')!
const activeRow = (): string | null => {
  const a = document.activeElement as HTMLElement | null
  return a?.closest('[data-row-id]')?.getAttribute('data-row-id') ?? a?.getAttribute('data-row-id') ?? null
}
function key(k: string, m: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { (document.activeElement ?? grid()).dispatchEvent(ev) })
  return ev
}
const focus = (): void => { act(() => { grid().focus() }) }
const withContext = (): void => {
  const id = useBillStore.getState().billId ?? 'x'
  useBillStore.setState({ billId: id })
  usePageMemoryStore.getState().setBillContext({ sourcePath: ROUTES.history, orderedBillIds: [id, 'other'], currentId: id })
}

describe('Phase 220 grid page keys', () => {
  it('Create / a bill without a list: PageDown pages the grid (unchanged)', () => {
    focus()
    const before = activeRow()
    const ev = key('PageDown')
    expect(ev.defaultPrevented).toBe(true)
    expect(activeRow()).not.toBe(before)
  })

  it('a bill opened from a list: plain PageDown / PageUp leave the grid alone (they step bills)', () => {
    withContext(); focus()
    const before = activeRow()
    key('PageDown'); key('PageUp')
    expect(activeRow()).toBe(before)
  })

  it('a bill opened from a list: Ctrl+PageDown / Ctrl+PageUp page the grid', () => {
    withContext(); focus()
    const before = activeRow()
    const ev = key('PageDown', { ctrlKey: true })
    expect(ev.defaultPrevented).toBe(true)
    const moved = activeRow()
    expect(moved).not.toBe(before)
    key('PageUp', { ctrlKey: true })
    expect(activeRow()).toBe(before)
  })
})
