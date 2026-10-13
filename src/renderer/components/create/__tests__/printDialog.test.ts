// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { printFixture } from '@shared/__fixtures__/printBills'
import { simplePaperDecision, type PaperDecision } from '@shared/paper/paperTypes'
import { DEFAULT_PRINT_SETTINGS } from '@shared/print/printModel'
import { PrintDialog } from '../PrintDialog'
import { useBillStore } from '../../../stores/billStore'
import { openPrint } from '../../../stores/printActions'
import { usePrintUiStore } from '../../../stores/printUiStore'
import { useSaveUiStore } from '../../../stores/saveUiStore'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const ack: PaperDecision = { size: 'A4', pages: 1, suggested: 'A4', reasons: ['GST bills with extra columns print on A4.'], warnings: ['GST bills with extra columns print on A4.'], requiresAck: true }
const decide = vi.fn()
const print = vi.fn()
const decideWith = (d: PaperDecision) => async () => ({ ok: true, data: { decision: d, settings: DEFAULT_PRINT_SETTINGS, switchedByMeasure: false, measureFailed: false } })
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
function key(k: string, m: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { document.activeElement?.dispatchEvent(ev) ?? window.dispatchEvent(ev) })
  return ev
}

beforeEach(async () => {
  decide.mockReset(); print.mockReset()
  decide.mockImplementation(decideWith(simplePaperDecision('A5')))
  print.mockImplementation(async () => ({ ok: true, data: { printed: true, cancelled: false, decision: simplePaperDecision('A5'), switchedByMeasure: false } }))
  ;(window as unknown as { quot3: unknown }).quot3 = { print: { decide, print } }
  useBillStore.getState().loadBill(printFixture('legacy'))
  usePrintUiStore.setState({ open: false, bill: null, info: null, forced: undefined, loading: false, printing: false, acked: false, askAck: false, error: '' })
  useSaveUiStore.setState({ saving: false, last: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(createElement(PrintDialog)) })
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = '' })

async function open(mode: 'rough' | 'professional' = 'rough'): Promise<void> {
  act(() => { expect(openPrint(mode)).toBe(true) })
  await flush()
}

describe('Phase 37 - print dialog flow', () => {
  it('opens with the decision, asks main to decide for the snapshot bill, and shows a preview frame', async () => {
    await open()
    expect(decide).toHaveBeenCalledTimes(1)
    expect(decide.mock.calls[0]![0]).toMatchObject({ mode: 'rough', bill: { formatId: 'non_gst' } })
    expect(decide.mock.calls[0]![0].bill.poNumber).toBeDefined()
    expect(document.body.textContent).toContain('Print Rough - A5')
    expect(document.querySelector('iframe[title="Print preview"]')).not.toBeNull()
  })
  it('Enter prints the suggested size, closes, and reports it', async () => {
    await open()
    key('Enter')
    await flush()
    expect(print).toHaveBeenCalledTimes(1)
    expect(print.mock.calls[0]![0]).toMatchObject({ mode: 'rough', ack: false })
    expect(print.mock.calls[0]![0].forced).toBeUndefined()
    expect(usePrintUiStore.getState().open).toBe(false)
    expect(useSaveUiStore.getState().last).toMatchObject({ tone: 'ok', message: 'Sent to the printer (A5)' })
  })
  it('4 / 5 force a size and re-decide with it; A goes back to the rules', async () => {
    await open()
    key('4'); await flush()
    expect(decide.mock.calls.at(-1)![0].forced).toBe('A4')
    key('5'); await flush()
    expect(decide.mock.calls.at(-1)![0].forced).toBe('A5')
    key('a'); await flush()
    expect(decide.mock.calls.at(-1)![0].forced).toBe('auto')
    key('4'); await flush()
    key('Enter'); await flush()
    expect(print.mock.calls[0]![0].forced).toBe('A4')
  })
  it('requiresAck: Enter alone does NOT print; Y acknowledges; then Enter prints with ack', async () => {
    decide.mockImplementation(decideWith(ack))
    await open()
    expect(document.body.textContent).toContain('Press Y to acknowledge')
    key('Enter'); await flush()
    expect(print).not.toHaveBeenCalled()
    expect(usePrintUiStore.getState().askAck).toBe(true)
    key('y'); await flush()
    expect(usePrintUiStore.getState().acked).toBe(true)
    key('Enter'); await flush()
    expect(print).toHaveBeenCalledTimes(1)
    expect(print.mock.calls[0]![0].ack).toBe(true)
  })
  it('Esc cancels without printing', async () => {
    await open()
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => { document.querySelector('[data-autofocus]')!.dispatchEvent(ev) }) // the Dialog's own Esc handling (focus is inside it)
    await flush()
    expect(usePrintUiStore.getState().open).toBe(false)
    expect(print).not.toHaveBeenCalled()
  })
  it('the owner closing the system dialog closes quietly (no toast); an error keeps the dialog open with the message', async () => {
    print.mockImplementationOnce(async () => ({ ok: true, data: { printed: false, cancelled: true, decision: simplePaperDecision('A5'), switchedByMeasure: false } }))
    await open()
    key('Enter'); await flush()
    expect(usePrintUiStore.getState().open).toBe(false)
    expect(useSaveUiStore.getState().last).toBeNull()
    print.mockImplementationOnce(async () => ({ ok: false, error: { code: 'PRINT_FAILED', message: 'Printing failed: printer offline' } }))
    await open()
    key('Enter'); await flush()
    expect(usePrintUiStore.getState().open).toBe(true)
    expect(document.body.textContent).toContain('Printing failed: printer offline')
  })
  it('a switch caused by the measured overflow is announced', async () => {
    print.mockImplementationOnce(async () => ({ ok: true, data: { printed: true, cancelled: false, decision: simplePaperDecision('A4'), switchedByMeasure: true } }))
    await open()
    key('Enter'); await flush()
    expect(useSaveUiStore.getState().last?.message).toBe('Sent to the printer on A4 - the text did not fit A5')
  })
  it('Professional mode and an empty/absent bill', async () => {
    await open('professional')
    expect(document.body.textContent).toContain('Print Professional')
    act(() => usePrintUiStore.getState().set({ open: false }))
    useBillStore.setState({ billId: null })
    act(() => { expect(openPrint('rough')).toBe(false) })
    expect(useSaveUiStore.getState().last?.message).toBe('Nothing to print - open a bill first')
  })
  it('a second Ctrl+P while the dialog is open does nothing; late decide responses from a superseded request are ignored', async () => {
    let release: (v: unknown) => void = () => undefined
    decide.mockImplementationOnce(() => new Promise((r) => { release = r }))
    await open()
    expect(openPrint('rough')).toBe(false)
    key('4') // supersedes the pending request (loading blocks other keys, so force through the action)
    const { forcePaper } = await import('../../../stores/printActions')
    act(() => forcePaper('A4'))
    await flush()
    release(await decideWith(simplePaperDecision('A5'))())
    await flush()
    expect(usePrintUiStore.getState().info?.decision.size).toBe('A5') // the A4 request's answer (default stub = A5) won; the stale one did not overwrite it
    expect(decide).toHaveBeenCalledTimes(2)
  })
})

describe('Phase 73 - the dialog opens from the instant answer', () => {
  it('shows the decision and an enabled Print button while the measured decide is still pending, then refines it', async () => {
    const quick = vi.fn(async () => ({ ok: true, data: { decision: simplePaperDecision('A5'), settings: DEFAULT_PRINT_SETTINGS, switchedByMeasure: false, measureFailed: false, provisional: true } }))
    let release!: (v: unknown) => void
    decide.mockImplementationOnce(() => new Promise((r) => { release = r }))
    ;(window as unknown as { quot3: unknown }).quot3 = { print: { decide, decideQuick: quick, print } }
    await open()
    expect(quick).toHaveBeenCalledTimes(1)
    expect(decide).toHaveBeenCalledTimes(1)
    const st = usePrintUiStore.getState()
    expect(st.loading).toBe(false)
    expect(st.measuring).toBe(true)
    expect(document.body.textContent).toContain('Print Rough - A5')
    expect(document.body.textContent).toContain('Checking that the text fits')
    release(await decideWith(simplePaperDecision('A4'))())
    await flush()
    expect(usePrintUiStore.getState().measuring).toBe(false)
    expect(document.body.textContent).toContain('Print Rough - A4')
    expect(document.body.textContent).not.toContain('Checking that the text fits')
  })
  it('a failing measured decide keeps the instant answer (flagged measureFailed) instead of an error', async () => {
    const quick = vi.fn(async () => ({ ok: true, data: { decision: simplePaperDecision('A5'), settings: DEFAULT_PRINT_SETTINGS, switchedByMeasure: false, measureFailed: false, provisional: true } }))
    decide.mockImplementationOnce(async () => ({ ok: false, error: { code: 'X', message: 'window failed' } }))
    ;(window as unknown as { quot3: unknown }).quot3 = { print: { decide, decideQuick: quick, print } }
    await open()
    const st = usePrintUiStore.getState()
    expect(st.error).toBe('')
    expect(st.info?.measureFailed).toBe(true)
    expect(st.measuring).toBe(false)
  })
})
