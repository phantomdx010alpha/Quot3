// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThemeShareStatus } from '@shared/theme/themeShare'
import { ThemeShareSection } from '../ThemeShareSection'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const base: ThemeShareStatus = { enabled: false, available: true, shared: [], aside: [], tooNew: 0, notice: '', last: null, running: false }
let host: HTMLDivElement
let root: Root
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve() }) }
const install = (status: ThemeShareStatus) => {
  const themes = {
    shareStatus: vi.fn(async () => ({ ok: true, data: status })),
    shareSetEnabled: vi.fn(async (enabled: boolean) => ({ ok: true, data: { ...status, enabled } })),
    shareSyncNow: vi.fn(async () => ({ ok: true, data: { run: { sent: 1, received: 2, setAside: 0, skipped: 0 }, status } })),
    removeShared: vi.fn(async () => ({ ok: true, data: { ...status, shared: [] } }))
  }
  ;(window as unknown as { quot3: unknown }).quot3 = { themes }
  return themes
}
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); delete (window as unknown as { quot3?: unknown }).quot3 })

describe('ThemeShareSection (Phase 171)', () => {
  it('renders nothing without the app bridge', async () => {
    act(() => root.render(createElement(ThemeShareSection)))
    await flush()
    expect(host.textContent).toBe('')
  })

  it('the switch is OFF by default and turning it on calls the app', async () => {
    const api = install(base)
    act(() => root.render(createElement(ThemeShareSection)))
    await flush()
    const box = host.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(box.checked).toBe(false)
    await act(async () => { box.click() })
    expect(api.shareSetEnabled).toHaveBeenCalledWith(true)
  })

  it('lists shared themes with their origin, removes one locally, and shows the set-aside and "Update the app" notice', async () => {
    const api = install({
      ...base, enabled: true, tooNew: 2, notice: 'Update the app to use 2 themes.',
      shared: [{ id: 'amber', name: 'Amber', origin: 'Shop A', editedAt: '2026-10-16T10:00:00.000Z' }, { id: 'mine', name: 'Mine', origin: 'This PC', editedAt: '2026-10-16T10:00:00.000Z' }],
      aside: [{ id: 'evil', reason: 'invalid', message: 'bad', origin: null }]
    })
    act(() => root.render(createElement(ThemeShareSection)))
    await flush()
    expect(host.textContent).toContain('From Shop A')
    expect(host.textContent).toContain('Added on this PC')
    expect(host.textContent).toContain('Update the app to use 2 themes.')
    expect(host.textContent).toContain('Not a valid theme')
    await act(async () => { (host.querySelector('button[aria-label="Remove Amber from this PC"]') as HTMLButtonElement).click() })
    expect(api.removeShared).toHaveBeenCalledWith('amber')
    expect(host.textContent).toContain('this PC only')
    await act(async () => { Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Sync themes now')!.click() })
    expect(host.textContent).toContain('Sent 1, received 2')
  })
})
