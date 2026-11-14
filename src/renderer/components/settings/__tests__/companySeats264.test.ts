// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MasterStatus } from '@shared/master/clientTypes'
import { CompanySeatsSection } from '../CompanySeatsSection'
import { useMasterLinkStore } from '../../../stores/masterLinkStore'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ST = (o: Partial<MasterStatus> = {}): MasterStatus => ({ configured: true, linked: false, companyLabel: null, seatNo: null, seatLabel: null, isAdmin: false, profileVersion: null, lastError: '', ...o })
let root: Root | undefined
let host: HTMLDivElement

async function show(master: MasterStatus, shared: { state: string; seatNo: number | null }): Promise<void> {
  ;(window as unknown as { quot3: unknown }).quot3 = { master: { status: vi.fn(async () => ({ ok: true, data: master })), link: vi.fn() }, syncShared: { status: vi.fn(async () => ({ ok: true, data: shared })) } }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root!.render(createElement(CompanySeatsSection)) })
  await act(async () => { await Promise.resolve() })
}
const hasButton = (t: string): boolean => [...host.querySelectorAll('button')].some((b) => b.textContent === t)

beforeEach(() => { useMasterLinkStore.setState({ status: null, sharedActive: false, sharedSeatNo: null, step: 'idle', enrolToken: '', label: '', serviceRoleKey: '', fieldErrors: {}, message: '' }) })
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; delete (window as unknown as { quot3?: unknown }).quot3 })

describe('Phase 264 Company seats section', () => {
  it('seat 1, not linked: status line and the Link to master button; the wizard opens with a password-style key field', async () => {
    await show(ST(), { state: 'activated', seatNo: 1 })
    expect(host.querySelector('[data-testid=seat-status]')?.textContent).toBe('Not linked to master')
    expect(hasButton('Link to master')).toBe(true)
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === 'Link to master')!.click() })
    const key = [...host.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Service role key'))!
    expect(host.querySelector<HTMLInputElement>(`#${key.getAttribute('for')}`)!.type).toBe('password')
  })
  it('seat 2 sees only the status line', async () => {
    await show(ST(), { state: 'activated', seatNo: 2 })
    expect(host.querySelector('[data-testid=seat-status]')?.textContent).toBe('Not linked to master')
    expect(hasButton('Link to master')).toBe(false)
  })
  it('linked: shows "Linked as seat N" and no wizard button', async () => {
    await show(ST({ linked: true, seatNo: 1, companyLabel: 'Acme', isAdmin: true }), { state: 'activated', seatNo: 1 })
    expect(host.querySelector('[data-testid=seat-status]')?.textContent).toBe('Linked as seat 1 of Acme')
    expect(hasButton('Link to master')).toBe(false)
  })
  it('a build with no master configured hides the button and says so', async () => {
    await show(ST({ configured: false }), { state: 'activated', seatNo: 1 })
    expect(hasButton('Link to master')).toBe(false)
    expect(host.textContent).toContain('not switched on')
  })
})
