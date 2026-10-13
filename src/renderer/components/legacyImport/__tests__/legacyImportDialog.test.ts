// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LegacyImportDialog } from '../LegacyImportDialog'
import { SourceFilter } from '../../history/SourceFilter'
import { ImportedNote } from '../../create/ImportedNote'
import { useBillStore } from '../../../stores/billStore'
import { useLegacyImportStore } from '../../../stores/legacyImportStore'
import { useHistoryStore } from '../../../stores/historyStore'
import { ACTIONS, SHORTCUTS, findShortcutConflicts } from '@shared/shortcuts'
import type { ImportReport } from '@shared/legacyImport'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const realRefresh = useHistoryStore.getState().refresh
let host: HTMLDivElement
let root: Root
let api: Record<string, ReturnType<typeof vi.fn>>
let history: Record<string, ReturnType<typeof vi.fn>>
let emit: ((p: unknown) => void) | null

const report = (over: Partial<ImportReport> = {}): ImportReport => ({
  filesFound: 4, filesRead: 4, errors: [], created: 3, skipped: [], renumbered: [],
  clashGroups: [{ number: 106, files: [{ file: 'a.json', party: 'Zed', date: '2026-10-01', defaultAction: 'keep', reason: 'earliest' }, { file: 'b.json', party: 'Ruby', date: '2026-10-02', defaultAction: 'renumber', reason: 'later' }] }],
  duplicateBillNoGroups: 1, poFirst: 1, poLast: 3, nextSeqAfter: 4, nextPoAfter: 'Q3-0004', newParties: 2, existingParties: 0,
  totalDifferences: [], formats: { gst: 1, nonGst: 2, defaultMode: 0 }, convert: {} as ImportReport['convert'], ignored: {} as ImportReport['ignored'], warnings: [], ...over
})
const prev = (over: Partial<ImportReport> = {}, canImport = true) => ({ ok: true, data: { sourceLabel: 'Bills_JSON', poPrefix: 'Q3', report: report(over), canImport } })
const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const btn = (text: string): HTMLButtonElement => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement
const click = async (el: Element): Promise<void> => { await act(async () => { (el as HTMLElement).click() }); await flush() }

beforeEach(async () => {
  emit = null
  useLegacyImportStore.setState({ step: 'closed', source: null, preview: null, result: null, choices: {}, batches: [], undoMessage: '', notice: '', error: '', busy: false, progress: null })
  useHistoryStore.setState({ source: 'all', batch: '', status: 'idle', refresh: realRefresh })
  api = {
    pick: vi.fn(async () => ({ ok: true, data: { sourceId: 's1', label: 'Bills_JSON', kind: 'folder' } })),
    preview: vi.fn(async () => prev()),
    commit: vi.fn(async () => ({ ok: true, data: { batchId: 'b1', sourceLabel: 'Bills_JSON', poPrefix: 'Q3', report: report(), backupFile: 'x.db', reportFile: null } })),
    cancel: vi.fn(async () => ({ ok: true, data: {} })),
    release: vi.fn(async () => ({ ok: true, data: {} })),
    saveReport: vi.fn(async () => ({ ok: true, data: { saved: true } })),
    undo: vi.fn(async () => ({ ok: true, data: { deleted: 3, keptEdited: [{ id: 'x', poNumber: 'Q3-0002' }], alreadyDeleted: 0, partiesRemoved: 2 } })),
    list: vi.fn(async () => ({ ok: true, data: [] })),
    billTag: vi.fn(async () => ({ ok: true, data: null }))
  }
  history = {
    listDates: vi.fn(async () => ({ ok: true, data: [] })), branches: vi.fn(async () => ({ ok: true, data: [] })),
    listBills: vi.fn(async () => ({ ok: true, data: { items: [] } })), search: vi.fn(async () => ({ ok: true, data: { items: [], truncated: false } }))
  }
  ;(window as unknown as { quot3: unknown }).quot3 = { legacyImport: api, history, on: (_c: string, cb: (p: unknown) => void) => { emit = cb; return () => undefined } }
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(createElement('div', null, createElement(LegacyImportDialog), createElement(SourceFilter))) })
})
afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); delete (window as unknown as { quot3?: unknown }).quot3 })

describe('LegacyImportDialog (Phase 86)', () => {
  it('has a shortcut and a palette action without conflicts', () => {
    expect(ACTIONS.some((a) => a.id === 'legacyImport.open')).toBe(true)
    expect(SHORTCUTS.filter((b) => b.action === 'legacyImport.open')).toHaveLength(1)
    expect(findShortcutConflicts()).toEqual([])
  })

  it('opens on the Pick step; a cancelled picker stays there', async () => {
    await act(async () => { await useLegacyImportStore.getState().open() }); await flush()
    expect(document.body.textContent).toContain('Choose folder')
    api.pick!.mockResolvedValueOnce({ ok: true, data: null })
    await click(btn('Choose folder'))
    expect(api.preview).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Choose folder')
  })

  it('Pick -> Preview shows the counts, the clash table with the planner defaults and the Import button', async () => {
    await act(async () => { await useLegacyImportStore.getState().open() }); await flush()
    await click(btn('Choose folder'))
    expect(api.pick).toHaveBeenCalledWith('folder')
    expect(api.preview).toHaveBeenCalledWith({ sourceId: 's1' })
    expect(document.body.textContent).toContain('3 bills will be created')
    expect(document.body.textContent).toContain('Next new bill after the import: Q3-0004')
    const sels = [...document.querySelectorAll('table[aria-label="Clashing bill numbers"] select')] as HTMLSelectElement[]
    expect(sels.map((s) => s.value)).toEqual(['import', 'renumber'])
    expect(btn('Import 3 bills')).toBeTruthy()
    expect(document.body.textContent).not.toContain('C:')
  })

  it('changing a clash choice previews again with that choice', async () => {
    await act(async () => { await useLegacyImportStore.getState().open() }); await flush()
    await click(btn('Choose folder'))
    const sel = document.querySelectorAll('table[aria-label="Clashing bill numbers"] select')[1] as HTMLSelectElement
    await act(async () => { sel.value = 'skip'; sel.dispatchEvent(new Event('change', { bubbles: true })) }); await flush()
    expect(api.preview).toHaveBeenLastCalledWith({ sourceId: 's1', choices: { 'b.json': 'skip' } })
  })

  it('shows reading progress from the event and cancelling reading changes nothing', async () => {
    let finish!: (v: unknown) => void
    api.preview!.mockImplementationOnce(() => new Promise((r) => { finish = r }))
    await act(async () => { await useLegacyImportStore.getState().open() }); await flush()
    await act(async () => { void useLegacyImportStore.getState().pick('folder') }); await flush()
    await act(async () => { emit?.({ sourceId: 's1', done: 120, total: 768 }) })
    expect(document.body.textContent).toContain('Reading 120 of 768')
    await click(btn('Cancel'))
    expect(api.cancel).toHaveBeenCalled()
    expect(api.commit).not.toHaveBeenCalled()
    finish(prev())
  })

  it('Import commits with the choices, reloads History, shows the report and Undo works', async () => {
    const refresh = vi.fn(async () => undefined)
    useHistoryStore.setState({ status: 'ready', refresh })
    await act(async () => { await useLegacyImportStore.getState().open() }); await flush()
    await click(btn('Choose folder'))
    await click(btn('Import 3 bills'))
    expect(api.commit).toHaveBeenCalledWith({ sourceId: 's1' })
    expect(document.body.textContent).toContain('3 bills imported. Next new bill: Q3-0004')
    expect(refresh).toHaveBeenCalled()
    await click(btn('Save report as CSV'))
    expect(api.saveReport).toHaveBeenCalledWith({ sourceId: 's1', format: 'csv' })
    await click(btn('Undo this import'))
    expect(api.undo).toHaveBeenCalledWith('b1')
    expect(document.body.textContent).toContain('3 bills moved to Recently deleted, 1 kept because they were edited since (Q3-0002)')
  })

  it('a failed import returns to the Preview with the reason; nothing claims success', async () => {
    api.commit!.mockResolvedValueOnce({ ok: false, error: { code: 'DB_ERROR', message: 'The import failed and was rolled back; nothing was changed.' } })
    await act(async () => { await useLegacyImportStore.getState().open() }); await flush()
    await click(btn('Choose folder'))
    await click(btn('Import 3 bills'))
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('rolled back')
    expect(document.body.textContent).not.toContain('imported.')
  })

  it('"Nothing to import" disables the button', async () => {
    api.preview!.mockResolvedValueOnce(prev({ created: 0, clashGroups: [] }, false))
    await act(async () => { await useLegacyImportStore.getState().open() }); await flush()
    await click(btn('Choose folder'))
    expect(btn('Nothing to import').disabled).toBe(true)
  })

  it('lists past imports with Undo; an undone one shows a badge', async () => {
    api.list!.mockResolvedValue({ ok: true, data: [
      { id: 'b1', at: '2026-10-10T10:00:00.000Z', sourceLabel: 'Bills_JSON', poPrefix: 'Q3', filesFound: 4, created: 3, skipped: 0, errors: 0, newParties: 2, poFirst: 1, poLast: 3, reportFile: null, undoneAt: null },
      { id: 'b0', at: '2026-10-01T10:00:00.000Z', sourceLabel: 'old', poPrefix: 'Q3', filesFound: 1, created: 1, skipped: 0, errors: 0, newParties: 0, poFirst: 9, poLast: 9, reportFile: null, undoneAt: '2026-10-02T00:00:00.000Z' }
    ] })
    await act(async () => { await useLegacyImportStore.getState().open() }); await flush()
    expect(document.querySelectorAll('table[aria-label="Past imports"] tbody tr')).toHaveLength(2)
    expect(document.body.textContent).toContain('Undone')
    expect(document.querySelectorAll('table[aria-label="Past imports"] button')).toHaveLength(1)
  })

  it('Esc closes the dialog from the Pick step and releases nothing it never held', async () => {
    await act(async () => { await useLegacyImportStore.getState().open() }); await flush()
    await act(async () => { document.querySelector('[role="dialog"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(api.release).not.toHaveBeenCalled()
  })

  it('History source filter: choosing Imported asks the store, which sends source to the list calls', async () => {
    const sel = document.querySelector('select[aria-label="Source filter"]') as HTMLSelectElement
    await act(async () => { sel.value = 'imported'; sel.dispatchEvent(new Event('change', { bubbles: true })) }); await flush()
    expect(useHistoryStore.getState().source).toBe('imported')
    expect(history.listDates).toHaveBeenLastCalledWith({ source: 'imported' })
    await act(async () => { await useHistoryStore.getState().setSource('imported', 'B1') }); await flush()
    expect(history.listDates).toHaveBeenLastCalledWith({ source: 'imported', batch: 'B1' })
    await act(async () => { await useHistoryStore.getState().setSource('created', 'B1') }); await flush()
    expect(useHistoryStore.getState().batch).toBe('')
    await act(async () => { await useHistoryStore.getState().clearFilters() }); await flush()
    expect(useHistoryStore.getState().source).toBe('all')
  })

  it('Create header: an imported bill shows the Imported mark with the full note; a bill made here shows nothing', async () => {
    await act(async () => { root.render(createElement(ImportedNote)) })
    api.billTag!.mockResolvedValueOnce({ ok: true, data: { legacyRef: 'BR1_106', importBatchId: 'b1' } })
    await act(async () => { useBillStore.setState({ billId: 'imp', billDate: '2026-10-08' }) }); await flush()
    const el = document.querySelector('[data-testid="imported-note"]') as HTMLElement
    expect(el.title).toBe('Imported from the old app \u00b7 old number BR1_106 \u00b7 08-10-26')
    expect(el.textContent).toContain('BR1_106')
    await act(async () => { useBillStore.setState({ billId: 'mine' }) }); await flush()
    expect(document.querySelector('[data-testid="imported-note"]')).toBeNull()
    await act(async () => { useBillStore.setState({ billId: null }) }); await flush()
    expect(api.billTag).toHaveBeenCalledTimes(2)
  })
})
