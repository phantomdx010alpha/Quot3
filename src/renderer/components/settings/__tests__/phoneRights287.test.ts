// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRESETS, SEAT_RIGHTS_HONEST_LIMIT, SEAT_RIGHT_FLAGS, SEAT_RIGHT_LABELS, type SeatRightsRow } from '@shared/seatRights'
import { PhoneRightsSettings } from '../PhoneRightsSettings'
import { useSeatRightsStore } from '../../../stores/seatRightsStore'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const row = (seatNo: number, o: Partial<SeatRightsRow> = {}): SeatRightsRow => ({ seatNo, branchName: null, flags: { ...PRESETS.Viewer }, configured: true, updatedAt: '2026-11-24T10:00:00.000Z', ...o })
const list = vi.fn()
const set = vi.fn()
let root: Root | undefined
let host: HTMLDivElement
async function show(rows: SeatRightsRow[], seatNo: number): Promise<void> {
  list.mockResolvedValue({ ok: true, data: rows })
  ;(window as unknown as { quot3: unknown }).quot3 = { seatRights: { list, set } }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root!.render(createElement(PhoneRightsSettings, { seatNo })) })
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}
const q = <T extends Element>(sel: string): T => host.querySelector(sel) as T
beforeEach(() => { list.mockReset(); set.mockReset(); useSeatRightsStore.getState().reset() })
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; delete (window as unknown as { quot3?: unknown }).quot3 })

describe('Phase 287 Phone rights block', () => {
  it('shows the eleven toggles in plain words, the three presets, the honest limit and the apply note', async () => {
    await show([row(1), row(2)], 2)
    expect(host.querySelectorAll('input[type=checkbox]')).toHaveLength(11)
    for (const f of SEAT_RIGHT_FLAGS) expect(host.textContent).toContain(SEAT_RIGHT_LABELS[f])
    for (const p of ['Full', 'Staff', 'Viewer']) expect(q(`[data-testid=phr-preset-${p}]`)).not.toBeNull()
    expect(q('[data-testid=phr-limit]').textContent).toBe(SEAT_RIGHTS_HONEST_LIMIT)
    expect(host.textContent).toContain('within moments')
    expect(host.textContent).not.toMatch(/secure|leak-proof/i)
    expect(q('[data-testid=phr-now]').textContent).toBe('Now: Viewer')
    expect(q('[data-testid=phr-last]').textContent).toContain('Last saved')
  })
  it('a seat the server never configured shows "Staff (default)" and the Staff toggles', async () => {
    await show([row(1), row(2, { configured: false, updatedAt: null, flags: { ...PRESETS.Full } })], 2)
    expect(q('[data-testid=phr-now]').textContent).toBe('Now: Staff (default)')
    expect(q<HTMLInputElement>('[data-testid=phr-2-shareBills]').checked).toBe(true)
    expect(q<HTMLInputElement>('[data-testid=phr-2-deleteBills]').checked).toBe(false)
    expect(q('[data-testid=phr-last]').textContent).toContain('Never saved')
  })
  it('a preset fills the toggles; Save is off until something changed, then sends the flags and says Saved', async () => {
    await show([row(1), row(2)], 2)
    expect(q<HTMLButtonElement>('[data-testid=phr-save]').disabled).toBe(true)
    await act(async () => { q<HTMLButtonElement>('[data-testid=phr-preset-Staff]').click() })
    expect(q<HTMLInputElement>('[data-testid=phr-2-shareBills]').checked).toBe(true)
    expect(q<HTMLInputElement>('[data-testid=phr-2-seeSales]').checked).toBe(false)
    expect(q<HTMLButtonElement>('[data-testid=phr-save]').disabled).toBe(false)
    set.mockResolvedValue({ ok: true, data: row(2, { flags: { ...PRESETS.Staff }, updatedAt: '2026-11-24T12:00:00.000Z' }) })
    await act(async () => { q<HTMLButtonElement>('[data-testid=phr-save]').click() })
    expect(set).toHaveBeenCalledWith({ seatNo: 2, flags: PRESETS.Staff })
    expect(host.textContent).toContain('Saved.')
    expect(q('[data-testid=phr-now]').textContent).toBe('Now: Staff')
  })
  it('a refusal shows in words and the Save stays available', async () => {
    await show([row(1), row(2)], 2)
    await act(async () => { q<HTMLInputElement>('[data-testid=phr-2-deleteBills]').click() })
    set.mockResolvedValue({ ok: false, error: { code: 'SYNC_OFFLINE', message: 'x' } })
    await act(async () => { q<HTMLButtonElement>('[data-testid=phr-save]').click() })
    expect(q('[data-testid=phr-error]').textContent).toContain('Nothing was saved')
    expect(host.textContent).not.toContain('Saved.')
    expect(q<HTMLButtonElement>('[data-testid=phr-save]').disabled).toBe(false)
  })
  it('an old company database says so in plain words and offers no toggles', async () => {
    list.mockResolvedValue({ ok: false, error: { code: 'not_available', message: 'x' } })
    ;(window as unknown as { quot3: unknown }).quot3 = { seatRights: { list, set } }
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await act(async () => { root!.render(createElement(PhoneRightsSettings, { seatNo: 2 })) })
    await act(async () => { await Promise.resolve() })
    expect(q('[data-testid=phr-error]').textContent).toContain('SQL file 23')
    expect(host.querySelectorAll('input[type=checkbox]')).toHaveLength(0)
  })
  it('every control is a native, keyboard reachable element (no tabindex tricks) with a help line', async () => {
    await show([row(1), row(2)], 2)
    expect(host.querySelectorAll('[tabindex]')).toHaveLength(0)
    for (const f of SEAT_RIGHT_FLAGS) expect(q(`#phr-2-${f}-help`)).not.toBeNull()
  })
})
