// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LicenseReveal } from '../SharedSyncSection'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Version 0.1.31 - Settings > Sync > "Show license key", over a fake bridge.
const KEY = 'Q3-ABCD-EFGH-JKLM'
let root: Root | undefined
let host: HTMLDivElement
const button = (t: string): HTMLButtonElement | undefined => [...host.querySelectorAll('button')].find((b) => b.textContent === t)
const tick = async (ms = 0): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

async function mount(reveal?: () => Promise<unknown>): Promise<void> {
  ;(window as unknown as { quot3: unknown }).quot3 = { syncShared: reveal ? { revealLicense: reveal } : {} }
  root = createRoot(host)
  await act(async () => { root!.render(createElement(LicenseReveal)) })
}

beforeEach(() => { vi.useFakeTimers(); host = document.createElement('div'); document.body.appendChild(host) })
afterEach(() => { act(() => { root?.unmount() }); root = undefined; host.remove(); delete (window as unknown as { quot3?: unknown }).quot3; vi.useRealTimers() })

describe('LicenseReveal', () => {
  it('shows nothing until asked, then shows the key, copies it and hides it again after 30 seconds', async () => {
    const write = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    await mount(async () => ({ ok: true, data: { license: KEY } }))
    expect(host.textContent).not.toContain(KEY)
    await act(async () => { button('Show license key')!.click() }); await tick()
    expect(host.querySelector('[data-testid="license-key"]')!.textContent).toBe(KEY)
    await act(async () => { button('Copy license key')!.click() }); await tick()
    expect(write).toHaveBeenCalledWith(KEY)
    expect(host.textContent).toContain('License key copied')
    await tick(30_001)
    expect(host.textContent).not.toContain(KEY)
    expect(button('Show license key')).toBeTruthy()
  })

  it('the Hide button hides it at once', async () => {
    await mount(async () => ({ ok: true, data: { license: KEY } }))
    await act(async () => { button('Show license key')!.click() }); await tick()
    await act(async () => { button('Hide')!.click() }); await tick()
    expect(host.textContent).not.toContain(KEY)
  })

  it('a refusal shows its message and no key', async () => {
    await mount(async () => ({ ok: false, error: { code: 'VALIDATION', message: 'The license key is not stored on this computer. Sign in to sync first.' } }))
    await act(async () => { button('Show license key')!.click() }); await tick()
    expect(host.textContent).toContain('not stored on this computer')
    expect(host.querySelector('[data-testid="license-key"]')).toBeNull()
  })

  it('renders nothing when the bridge has no revealLicense (an older build)', async () => {
    await mount()
    expect(host.innerHTML).toBe('')
  })
})
