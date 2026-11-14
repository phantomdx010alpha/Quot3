// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SeatView } from '@shared/master/schemas'
import { CompanySeatsSection } from '../CompanySeatsSection'
import { useMasterLinkStore } from '../../../stores/masterLinkStore'
import { useMasterSeatsStore } from '../../../stores/masterSeatsStore'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const seat = (no: number, o: Partial<SeatView> = {}): SeatView => ({ no, label: `Seat ${no}`, email: null, status: 'active', legacy: false, code: `CODE-${no}`, codeHint: `..${no}`, createdAt: '2026-11-13T05:00:00.000Z', resetAt: null, devices: 0, lastSeenAt: null, ...o })
const STATUS = (o: object = {}) => ({ configured: true, linked: true, companyLabel: 'Acme', seatNo: 1, seatLabel: 'Seat 1', isAdmin: true, profileVersion: 1, lastError: '', ...o })
let root: Root | undefined
let host: HTMLDivElement
const seatList = vi.fn()

async function show(status: object): Promise<void> {
  seatList.mockResolvedValue({ ok: true, data: { company: { id: 'c', label: 'Acme', maxSeats: 15, status: 'active' }, seats: [seat(1, { code: null, legacy: true }), seat(2)] } })
  ;(window as unknown as { quot3: unknown }).quot3 = { master: { status: vi.fn(async () => ({ ok: true, data: status })), link: vi.fn(), seatList, seatCreate: vi.fn() }, syncShared: { status: vi.fn(async () => ({ ok: true, data: { state: 'activated', seatNo: status === undefined ? 2 : (status as { seatNo: number }).seatNo } })) } }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root!.render(createElement(CompanySeatsSection)) })
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}
const btn = (t: string): HTMLButtonElement | undefined => [...host.querySelectorAll('button')].find((b) => b.textContent === t)

beforeEach(() => { seatList.mockReset(); useMasterLinkStore.setState({ status: null, step: 'idle' }); useMasterSeatsStore.getState().clear() })
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; delete (window as unknown as { quot3?: unknown }).quot3 })

describe('Phase 265 seat list panel', () => {
  it('seat 1 (linked) sees the table, the "existing login" badge, and Show code only for the seat that has a code', async () => {
    await show(STATUS())
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(host.querySelector('[data-testid=legacy-1]')?.textContent).toContain('existing login')
    expect(host.querySelector('[data-testid=code-2]')).toBeNull()
    await act(async () => { btn('Show code')!.click() })
    expect(host.querySelector('[data-testid=code-2]')?.textContent).toBe('CODE-2')
    expect([...host.querySelectorAll('button')].filter((b) => b.textContent === 'Show code')).toHaveLength(0)
  })
  it('a linked seat 2 sees only the status line and never asks the master for the list', async () => {
    await show(STATUS({ seatNo: 2, isAdmin: false }))
    expect(host.querySelector('[data-testid=seat-status]')?.textContent).toBe('Linked as seat 2 of Acme')
    expect(host.querySelector('table')).toBeNull()
    expect(seatList).not.toHaveBeenCalled()
  })
})
