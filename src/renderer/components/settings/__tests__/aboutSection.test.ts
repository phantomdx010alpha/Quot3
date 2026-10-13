// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { AboutSection } from '../AboutSection'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('Phase 63 - About section', () => {
  afterEach(() => { delete (window as unknown as { quot3?: unknown }).quot3 })
  it('shows the name, publisher and the version main reports', async () => {
    ;(window as unknown as { quot3: unknown }).quot3 = { app: { getInfo: async () => ({ ok: true, data: { version: '1.4.0-beta.2' } }) } }
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(createElement(AboutSection)) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(host.textContent).toContain('Quot3')
    expect(host.textContent).toContain('Publisher: Ankit Shukla')
    expect(host.textContent).toContain('phantomdx9@gmail.com')
    expect(host.querySelector('[data-testid="about-version"]')?.textContent).toBe('Version 1.4.0 (beta 2)')
    expect(host.querySelector('img')).not.toBeNull()
    act(() => root.unmount()); host.remove()
  })
})
