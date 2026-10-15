// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Create from '../../../pages/Create'
import { useBillStore } from '../../../stores/billStore'
import { usePartyUiStore } from '../../../stores/partyUiStore'
import { usePartyIndexStore } from '../../../stores/partyIndexStore'
import { useGridUiStore } from '../../../stores/gridUiStore'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
function mount(): void { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); act(() => { root.render(createElement(Create)) }) }
beforeEach(() => {
  useBillStore.setState({ billId: null }); usePartyUiStore.setState({ addressOpen: false }); useGridUiStore.setState({ mode: 'idle', armed: false, notice: '' })
  usePartyIndexStore.getState().setParties([])
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const field = (n: string) => host.querySelector<HTMLInputElement>(`[data-party-field="${n}"]`)!
const key = (el: Element, k: string, m: Partial<KeyboardEventInit> = {}): KeyboardEvent => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { el.dispatchEvent(ev) })
  return ev
}
const caret = (el: HTMLInputElement, at: number): void => { el.setSelectionRange(at, at) }

describe('0.1.11 - party bar keys and focus', () => {
  it('opening Create puts the cursor on Party name', async () => {
    mount()
    await act(async () => { await new Promise((r) => setTimeout(r, 5)) })
    expect(document.activeElement).toBe(field('name'))
  })

  it('Left at the very start moves back a field; in the middle it stays in the text; Party name has nowhere to go', () => {
    mount()
    const name = field('name'); const phone = field('phone'); const transport = field('transport')
    act(() => { transport.focus() })
    transport.value = 'VRL'; caret(transport, 2)
    expect(key(transport, 'ArrowLeft').defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(transport)
    caret(transport, 0)
    expect(key(transport, 'ArrowLeft').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(phone)
    caret(phone, 0)
    key(phone, 'ArrowLeft')
    expect(document.activeElement).toBe(name)
    caret(name, 0)
    expect(key(name, 'ArrowLeft').defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(name)
  })

  it('Down from Party name, Phone or Transport lands on the grid', () => {
    mount()
    for (const f of ['name', 'phone', 'transport']) {
      act(() => { field(f).focus() })
      expect(key(field(f), 'ArrowDown').defaultPrevented).toBe(true)
      expect(document.activeElement?.closest('[role=grid]') ?? document.activeElement?.getAttribute('role')).toBeTruthy()
    }
  })
})
