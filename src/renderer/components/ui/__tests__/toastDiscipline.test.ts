// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast, addToast, MAX_VISIBLE_TOASTS, type ToastApi } from '../Toast'
import { RouteToastClear } from '../../RouteToastClear'
import { SaveFlow } from '../../create/SaveFlow'
import { QuietStatus } from '../../create/QuietStatus'
import { useSaveUiStore } from '../../../stores/saveUiStore'
import { useRouter } from '../../../router/routerStore'
import { ROUTES } from '@shared/routes'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let api: ToastApi
function Grab(): null { api = useToast(); return null }
const count = (): number => host.querySelectorAll('.q3-toast').length
const texts = (): string[] => [...host.querySelectorAll('.q3-toast__msg')].map((n) => n.textContent ?? '')

beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useSaveUiStore.setState({ last: null, quiet: null, quietHosts: 0, saving: false })
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

const mount = (...kids: unknown[]): void => {
  act(() => root.render(createElement(ToastProvider, null, createElement(Grab), ...(kids as never[]))))
}

describe('Phase 116 - pure addToast', () => {
  it('identical tone+message replaces in place; cap keeps the newest', () => {
    const a = { id: 1, tone: 'ok', message: 'x' }
    expect(addToast([a], { id: 1, tone: 'ok', message: 'x' })).toHaveLength(1)
    const three = addToast(addToast(addToast([], { id: 1, tone: 'ok', message: 'a' }), { id: 2, tone: 'ok', message: 'b' }), { id: 3, tone: 'ok', message: 'c' })
    expect(three.map((t) => t.message)).toEqual(['b', 'c'])
    expect(MAX_VISIBLE_TOASTS).toBe(2)
  })
})

describe('Phase 116 - ToastProvider', () => {
  it('10 identical shows = 1 toast', () => {
    mount()
    act(() => { for (let i = 0; i < 10; i++) api.show('Image copied - 675 x 228 px', 'ok') })
    expect(count()).toBe(1)
  })
  it('cap of 2 is respected with different messages', () => {
    mount()
    act(() => { api.show('a'); api.show('b'); api.show('c'); api.show('d') })
    expect(texts()).toEqual(['c', 'd'])
  })
  it('an identical show restarts the timer', () => {
    mount()
    act(() => { api.show('same', 'ok', 1000) })
    act(() => { vi.advanceTimersByTime(800) })
    act(() => { api.show('same', 'ok', 1000) })
    act(() => { vi.advanceTimersByTime(800) })
    expect(count()).toBe(1)
    act(() => { vi.advanceTimersByTime(300) })
    expect(count()).toBe(0)
  })
  it('clear() removes everything', () => {
    mount()
    act(() => { api.show('a'); api.show('b') })
    act(() => { api.clear() })
    expect(count()).toBe(0)
  })
})

describe('Phase 116 - page change and replay', () => {
  it('a page change clears the toasts', () => {
    mount(createElement(RouteToastClear))
    act(() => { api.show('a', 'warn'); api.show('b', 'warn') })
    expect(count()).toBe(2)
    act(() => { useRouter.getState().navigate(ROUTES.history) })
    expect(count()).toBe(0)
  })
  it('a page that mounts SaveFlow later does NOT replay the previous notice (the stacked-toast cause)', () => {
    useSaveUiStore.getState().announce('warn', 'Old notice')
    mount(createElement(SaveFlow))
    expect(count()).toBe(0)
    act(() => { useSaveUiStore.getState().announce('warn', 'New notice') })
    expect(texts()).toEqual(['New notice'])
  })
  it('three page mounts in a row with one old event produce no toasts', () => {
    useSaveUiStore.getState().announce('danger', 'Could not copy')
    for (let i = 0; i < 3; i++) { mount(createElement(SaveFlow)); act(() => root.render(createElement('div'))) }
    expect(count()).toBe(0)
  })
})

describe('Phase 116 - quiet status line', () => {
  it('ok notices go to the quiet line (no toast) when one is mounted; warn still toasts', () => {
    mount(createElement(SaveFlow), createElement(QuietStatus))
    act(() => { useSaveUiStore.getState().announce('ok', 'Bill copied - paste into Excel') })
    expect(count()).toBe(0)
    expect(host.querySelector('.q3-bbar__quiet')?.textContent).toBe('Bill copied - paste into Excel')
    act(() => { useSaveUiStore.getState().announce('warn', 'Nothing to copy yet') })
    expect(texts()).toEqual(['Nothing to copy yet'])
    act(() => { vi.advanceTimersByTime(5100) })
    expect(host.querySelector('.q3-bbar__quiet')?.textContent).toBe('')
  })
  it('without a quiet line mounted an ok notice falls back to a toast', () => {
    mount(createElement(SaveFlow))
    act(() => { useSaveUiStore.getState().announce('ok', 'Saved') })
    expect(texts()).toEqual(['Saved'])
  })
  it('a freshly mounted quiet line does not show an old event', () => {
    useSaveUiStore.getState().announce('ok', 'old')
    mount(createElement(QuietStatus))
    expect(host.querySelector('.q3-bbar__quiet')?.textContent).toBe('')
  })
})
