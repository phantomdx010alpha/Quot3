// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { printFixture } from '../../../../shared/__fixtures__/printBills'
import { useBillStore } from '../../../stores/billStore'
import { copyBillImage } from '../../../stores/outputActions'
import { useSaveUiStore } from '../../../stores/saveUiStore'

/** Phase 39 - the renderer side of Copy as image (stubbed bridge). */
function load(): void {
  const b = printFixture('legacy')
  useBillStore.getState().loadBill(b)
}

describe('Phase 39 - copyBillImage', () => {
  beforeEach(() => { useSaveUiStore.setState({ last: null }); delete (window as unknown as { quot3?: unknown }).quot3 })

  it('with no open bill: a warning, the bridge is not called', async () => {
    const copy = vi.fn()
    ;(window as unknown as { quot3: unknown }).quot3 = { image: { copy } }
    useBillStore.setState({ billId: null })
    expect(await copyBillImage('rough')).toBe(false)
    expect(copy).not.toHaveBeenCalled()
    expect(useSaveUiStore.getState().last?.tone).toBe('warn')
  })

  it('success: calls image:copy with the bill + mode and toasts the real pixel size', async () => {
    load()
    const copy = vi.fn(async (_i: unknown) => ({ ok: true, data: { width: 1480, height: 2310, paper: 'A5' } }))
    ;(window as unknown as { quot3: unknown }).quot3 = { image: { copy } }
    expect(await copyBillImage('professional')).toBe(true)
    expect(copy.mock.calls[0]![0]).toMatchObject({ mode: 'professional' })
    expect(useSaveUiStore.getState().last).toMatchObject({ tone: 'ok' })
    expect(useSaveUiStore.getState().last?.message).toContain('1,480')
  })

  it('failure (e.g. too tall): the service message is shown as a danger toast', async () => {
    load()
    const copy = vi.fn(async () => ({ ok: false, error: { code: 'IMAGE_FAILED', message: 'This bill is too long for one image' } }))
    ;(window as unknown as { quot3: unknown }).quot3 = { image: { copy } }
    expect(await copyBillImage('rough')).toBe(false)
    expect(useSaveUiStore.getState().last).toMatchObject({ tone: 'danger', message: 'This bill is too long for one image' })
  })

  it('no bridge: a danger toast, no throw', async () => {
    load()
    expect(await copyBillImage('rough')).toBe(false)
    expect(useSaveUiStore.getState().last?.tone).toBe('danger')
  })
})
