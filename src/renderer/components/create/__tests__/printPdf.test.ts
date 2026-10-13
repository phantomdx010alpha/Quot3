// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { printFixture } from '@shared/__fixtures__/printBills'
import { simplePaperDecision, type PaperDecision } from '@shared/paper/paperTypes'
import { DEFAULT_PRINT_SETTINGS } from '@shared/print/printModel'
import { PrintDialog } from '../PrintDialog'
import { useBillStore } from '../../../stores/billStore'
import { lastSavedPdf, openLastPdf, openPrint, resetPdfMemory } from '../../../stores/printActions'
import { usePrintUiStore } from '../../../stores/printUiStore'
import { useSaveUiStore } from '../../../stores/saveUiStore'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const ack: PaperDecision = { size: 'A4', pages: 1, suggested: 'A4', reasons: ['GST bills with extra columns print on A4.'], warnings: ['GST bills with extra columns print on A4.'], requiresAck: true }
const decide = vi.fn()
const print = vi.fn()
const pdf = vi.fn()
const openPdf = vi.fn()
const decideWith = (d: PaperDecision) => async () => ({ ok: true, data: { decision: d, settings: DEFAULT_PRINT_SETTINGS, switchedByMeasure: false, measureFailed: false } })
const saved = (d: PaperDecision = simplePaperDecision('A5'), pages = 1) => async () => ({ ok: true, data: { saved: true, cancelled: false, filePath: 'C:\\Users\\x\\Documents\\Q3-0001-2026-10-09.pdf', pages, decision: d, switchedByMeasure: false } })
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
function key(k: string, m: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { document.activeElement?.dispatchEvent(ev) ?? window.dispatchEvent(ev) })
  return ev
}

beforeEach(async () => {
  for (const f of [decide, print, pdf, openPdf]) f.mockReset()
  decide.mockImplementation(decideWith(simplePaperDecision('A5')))
  pdf.mockImplementation(saved())
  openPdf.mockImplementation(async () => ({ ok: true, data: {} }))
  ;(window as unknown as { quot3: unknown }).quot3 = { print: { decide, print, pdf, openPdf } }
  resetPdfMemory()
  useBillStore.getState().loadBill(printFixture('legacy'))
  usePrintUiStore.setState({ open: false, bill: null, info: null, forced: undefined, loading: false, printing: false, saving: false, autoPdf: false, acked: false, askAck: false, error: '' })
  useSaveUiStore.setState({ saving: false, last: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(createElement(PrintDialog)) })
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = '' })

async function open(mode: 'rough' | 'professional' = 'rough', pdfFirst = false): Promise<void> {
  act(() => { expect(openPrint(mode, pdfFirst ? { pdf: true } : {})).toBe(true) })
  await flush()
}

describe('Phase 38 - Save PDF from the print dialog', () => {
  it('S saves a PDF for the same bill/mode/forced size, closes the dialog and reports the file name and size', async () => {
    await open()
    key('s'); await flush()
    expect(pdf).toHaveBeenCalledTimes(1)
    expect(pdf.mock.calls[0]![0]).toMatchObject({ mode: 'rough', ack: false })
    expect(pdf.mock.calls[0]![0].savePath).toBeUndefined() // the Save dialog is main's
    expect(print).not.toHaveBeenCalled()
    expect(usePrintUiStore.getState().open).toBe(false)
    expect(useSaveUiStore.getState().last).toMatchObject({ tone: 'ok' })
    expect(useSaveUiStore.getState().last?.message).toContain('Saved Q3-0001-2026-10-09.pdf (A5)')
    expect(lastSavedPdf()).toBe('C:\\Users\\x\\Documents\\Q3-0001-2026-10-09.pdf')
  })
  it('the Save PDF button does the same, and says how many pages for a multi-page A4', async () => {
    pdf.mockImplementation(saved(simplePaperDecision('A4'), 2))
    await open()
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').startsWith('Save PDF'))!
    expect(btn).toBeDefined()
    act(() => { btn.click() }); await flush()
    expect(pdf).toHaveBeenCalledTimes(1)
    expect(useSaveUiStore.getState().last?.message).toContain('(A4, 2 pages)')
  })
  it('a forced size (4) is passed through to the PDF', async () => {
    await open()
    key('4'); await flush()
    key('s'); await flush()
    expect(pdf.mock.calls[0]![0].forced).toBe('A4')
  })
  it('requiresAck: S alone does NOT save; Y acknowledges; then S saves with ack', async () => {
    decide.mockImplementation(decideWith(ack))
    await open()
    key('s'); await flush()
    expect(pdf).not.toHaveBeenCalled()
    expect(usePrintUiStore.getState().askAck).toBe(true)
    key('y'); await flush()
    key('s'); await flush()
    expect(pdf).toHaveBeenCalledTimes(1)
    expect(pdf.mock.calls[0]![0].ack).toBe(true)
  })
  it('closing the Save dialog keeps the print dialog open and stays quiet', async () => {
    pdf.mockImplementation(async () => ({ ok: true, data: { saved: false, cancelled: true, filePath: null, pages: 0, decision: simplePaperDecision('A5'), switchedByMeasure: false } }))
    await open()
    key('s'); await flush()
    expect(usePrintUiStore.getState().open).toBe(true)
    expect(usePrintUiStore.getState().saving).toBe(false)
    expect(useSaveUiStore.getState().last).toBeNull()
    expect(lastSavedPdf()).toBeNull()
  })
  it('a failure shows its message in the dialog (still open) and a later S can retry', async () => {
    pdf.mockImplementationOnce(async () => ({ ok: false, error: { code: 'PRINT_FAILED', message: 'Could not save the PDF: EBUSY' } }))
    await open()
    key('s'); await flush()
    expect(document.body.textContent).toContain('EBUSY')
    expect(usePrintUiStore.getState().open).toBe(true)
    key('s'); await flush()
    expect(usePrintUiStore.getState().open).toBe(false)
  })
  it('a thrown bridge error is reported, not swallowed', async () => {
    pdf.mockImplementationOnce(async () => { throw new Error('bridge down') })
    await open()
    key('s'); await flush()
    expect(usePrintUiStore.getState().error).toContain('bridge down')
    expect(usePrintUiStore.getState().saving).toBe(false)
  })
  it('only one save at a time (a second S while saving is ignored)', async () => {
    let release: (v: unknown) => void = () => undefined
    pdf.mockImplementationOnce(() => new Promise((r) => { release = r }))
    await open()
    key('s'); key('s'); await flush()
    expect(pdf).toHaveBeenCalledTimes(1)
    key('Enter'); await flush()
    expect(print).not.toHaveBeenCalled() // printing is blocked while saving
    await act(async () => { release({ ok: true, data: { saved: true, cancelled: false, filePath: 'C:\\a.pdf', pages: 1, decision: simplePaperDecision('A5'), switchedByMeasure: false } }); await Promise.resolve() })
    expect(usePrintUiStore.getState().open).toBe(false)
  })
  it('the palette "Save PDF" opens the dialog and saves as soon as the decision is in', async () => {
    await open('professional', true)
    expect(pdf).toHaveBeenCalledTimes(1)
    expect(pdf.mock.calls[0]![0]).toMatchObject({ mode: 'professional' })
    expect(usePrintUiStore.getState().open).toBe(false)
  })
  it('the palette "Save PDF" waits for the acknowledgement when the decision needs one', async () => {
    decide.mockImplementation(decideWith(ack))
    await open('rough', true)
    expect(pdf).not.toHaveBeenCalled()
    expect(usePrintUiStore.getState().open).toBe(true)
    key('y'); await flush()
    key('s'); await flush()
    expect(pdf).toHaveBeenCalledTimes(1)
  })
})

describe('Phase 38 - Open last saved PDF', () => {
  it('warns when nothing was saved; after a save it opens that exact file', async () => {
    expect(await openLastPdf()).toBe(false)
    expect(useSaveUiStore.getState().last).toMatchObject({ tone: 'warn' })
    expect(openPdf).not.toHaveBeenCalled()
    await open()
    key('s'); await flush()
    expect(await openLastPdf()).toBe(true)
    expect(openPdf).toHaveBeenCalledWith({ filePath: 'C:\\Users\\x\\Documents\\Q3-0001-2026-10-09.pdf' })
  })
  it('an open failure is reported as an error toast', async () => {
    await open(); key('s'); await flush()
    openPdf.mockImplementationOnce(async () => ({ ok: false, error: { code: 'NOT_FOUND', message: 'That PDF no longer exists' } }))
    expect(await openLastPdf()).toBe(false)
    expect(useSaveUiStore.getState().last).toMatchObject({ tone: 'danger', message: 'That PDF no longer exists' })
  })
})
