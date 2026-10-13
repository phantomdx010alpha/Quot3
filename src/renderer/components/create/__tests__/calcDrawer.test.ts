// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Create from '../../../pages/Create'
import { useHotkeys } from '../../../hooks/useHotkeys'
import { useAppActions } from '../../../hooks/useAppActions'
import { useBillStore } from '../../../stores/billStore'
import { useCalcPanelStore } from '../../../stores/calcPanelStore'
import { useBehaviourStore } from '../../../stores/behaviourStore'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const set = vi.fn(async () => ({ ok: true, data: { key: 'x', value: null } }))
const get = vi.fn(async () => ({ ok: true, data: { value: null } }))

function Shell(): React.JSX.Element {
  const actions = useAppActions()
  useHotkeys([], actions)
  return createElement(Create)
}
const drawer = (): HTMLElement | null => host.querySelector('.q3-calc')
const field = (): HTMLInputElement => host.querySelector('.q3-calc__field') as HTMLInputElement
async function key(target: EventTarget, k: string, m: Partial<KeyboardEventInit> = {}): Promise<void> {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })) })
}
async function type(el: HTMLInputElement, v: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(async () => {
  ;(window as unknown as { quot3: unknown }).quot3 = { settings: { get, set } }
  useCalcPanelStore.setState({ open: false, mode: 'calc', expr: '', typedPercent: '' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(createElement(Shell)) })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (window as unknown as { quot3?: unknown }).quot3
  set.mockClear()
})

describe('calculator drawer (Phase 83)', () => {
  it('is closed by default and Alt+C opens it with the field focused, then closes and gives focus back', async () => {
    expect(drawer()).toBeNull()
    const grid = host.querySelector('[role=grid]') as HTMLElement
    grid.focus()
    await key(window, 'c', { altKey: true })
    expect(drawer()).not.toBeNull()
    expect(document.activeElement).toBe(field())
    await key(window, 'c', { altKey: true })
    expect(drawer()).toBeNull()
    expect(host.contains(document.activeElement)).toBe(true)
  })

  it('persists open and mode through the settings bridge', async () => {
    await key(window, 'c', { altKey: true })
    expect(set).toHaveBeenCalledWith('calc.open', true)
    await key(window, 'C', { altKey: true, shiftKey: true })
    expect(set).toHaveBeenCalledWith('calc.mode', 'percent')
  })

  it('types, shows a live result, Enter chains, Esc clears then closes', async () => {
    await key(window, 'c', { altKey: true })
    await type(field(), '100 + 10%')
    expect(host.querySelector('.q3-calc__result')!.textContent).toBe('= 110')
    await key(field(), 'Enter')
    expect(field().value).toBe('110')
    await type(field(), '110*2')
    await key(field(), 'Enter')
    expect(field().value).toBe('220')
    await key(field(), 'Escape')
    expect(field().value).toBe('')
    expect(drawer()).not.toBeNull()
    await key(field(), 'Escape')
    expect(drawer()).toBeNull()
  })

  it('shows an inline error for bad input and leaves the field alone on Enter', async () => {
    await key(window, 'c', { altKey: true })
    await type(field(), '1/0')
    expect(host.querySelector('.q3-calc__result--error')).not.toBeNull()
    await key(field(), 'Enter')
    expect(field().value).toBe('1/0')
  })

  it('never marks the bill dirty and never touches undo', async () => {
    const before = useBillStore.getState()
    await key(window, 'c', { altKey: true })
    await type(field(), '5*5')
    await key(field(), 'Enter')
    const after = useBillStore.getState()
    expect(after.dirty).toBe(before.dirty)
    expect(after.canUndo).toBe(before.canUndo)
  })

  it('% mode shows the three results for the live total and the preset chips', async () => {
    useBehaviourStore.setState({ percentPresets: ['18', '5'] })
    useCalcPanelStore.setState({ open: true, mode: 'percent' })
    await act(async () => { root.render(createElement(Shell)) })
    const chips = [...host.querySelectorAll('.q3-calc__chip')].map((c) => c.textContent)
    expect(chips).toEqual(['18%', '5%'])
    expect(host.querySelector('.q3-calc__total')).not.toBeNull()
  })
})
