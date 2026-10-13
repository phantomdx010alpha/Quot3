// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PartyImportDialog } from '../PartyImportDialog'
import { usePartyImportStore } from '../../../stores/partyImportStore'
import { ACTIONS, SHORTCUTS } from '@shared/shortcuts'
import type { PartyImportPreview } from '@shared/partyImport/partyImport'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let api: Record<string, ReturnType<typeof vi.fn>>

const preview = (over: Partial<PartyImportPreview> = {}): PartyImportPreview => ({
  fileName: 'parties.xlsx', sheets: ['Sheet1'], sheet: 'Sheet1', headerRow: 1, headers: ['Party', 'Mobile', 'Place'],
  mapping: { name: 0, phone: 1, address: 2, transport: null }, sample: [], totalRows: 3,
  summary: { new: 2, update: 0, duplicate: 1, repeated: 0, invalid: 0, blank: 0 },
  rows: [
    { row: 2, status: 'new', name: 'Ruby Traders', phone: '98450 11001', address: '', transport: '', reason: '' },
    { row: 3, status: 'new', name: 'Zed', phone: '', address: '', transport: '', reason: '' },
    { row: 4, status: 'duplicate', name: 'Old Co', phone: '', address: '', transport: '', reason: 'Already exists' }
  ], ...over
})
const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const btn = (text: string): HTMLButtonElement => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement
const click = async (el: Element): Promise<void> => { await act(async () => { (el as HTMLElement).click() }); await flush() }

beforeEach(async () => {
  usePartyImportStore.setState({ step: 'closed', onChanged: null })
  api = {
    pickFile: vi.fn(async () => ({ ok: true, data: { filePath: 'C:/x/parties.xlsx' } })),
    preview: vi.fn(async () => ({ ok: true, data: preview() })),
    commit: vi.fn(async () => ({ ok: true, data: { importId: 'imp1', created: 2, updated: 0, skipped: 1, invalid: 0, details: preview().rows } })),
    undo: vi.fn(async () => ({ ok: true, data: { removed: 2, restored: 0, kept: 0 } })),
    list: vi.fn(async () => ({ ok: true, data: [] }))
  }
  ;(window as unknown as { quot3: unknown }).quot3 = { partyImport: api }
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(createElement(PartyImportDialog)) })
})
afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); delete (window as unknown as { quot3?: unknown }).quot3 })

describe('PartyImportDialog', () => {
  it('cancelling the file dialog shows nothing', async () => {
    api.pickFile!.mockResolvedValueOnce({ ok: true, data: null })
    await act(async () => { await usePartyImportStore.getState().start() }); await flush()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(api.preview).not.toHaveBeenCalled()
  })

  it('shows the auto-detected mapping, the summary and the preview rows; Import runs the commit then shows the report', async () => {
    const changed = vi.fn(); usePartyImportStore.setState({ onChanged: changed })
    await act(async () => { await usePartyImportStore.getState().start() }); await flush()
    expect(document.body.textContent).toContain('parties.xlsx - 3 data rows')
    expect(document.body.textContent).toContain('2 new, 0 to update, 1 skipped, 0 with problems')
    expect((document.querySelector('select[aria-invalid]') ?? document.querySelectorAll('select')[0]) as HTMLSelectElement).toBeTruthy()
    expect(document.querySelectorAll('table[aria-label="Import preview"] tbody tr')).toHaveLength(3)
    await click(btn('Import 2 parties'))
    expect(api.commit).toHaveBeenCalledWith({ filePath: 'C:/x/parties.xlsx', sheet: 'Sheet1', headerRow: 1, mapping: { name: 0, phone: 1, address: 2, transport: null }, mode: 'skip' })
    expect(document.querySelector('[role="status"]')?.textContent).toBe('2 added, 0 updated, 1 skipped')
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('changing a column or the duplicate mode re-previews with the new choice', async () => {
    await act(async () => { await usePartyImportStore.getState().start() }); await flush()
    await act(async () => { await usePartyImportStore.getState().setMapping('transport', 2) }); await flush()
    expect(api.preview).toHaveBeenLastCalledWith(expect.objectContaining({ mapping: { name: 0, phone: 1, address: 2, transport: 2 } }))
    await act(async () => { await usePartyImportStore.getState().setMode('update') }); await flush()
    expect(api.preview).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'update' }))
  })

  it('no name column: Import is disabled and a hint shows; nothing is committed', async () => {
    api.preview!.mockResolvedValue({ ok: true, data: preview({ mapping: { name: null, phone: null, address: null, transport: null }, summary: { new: 0, update: 0, duplicate: 0, repeated: 0, invalid: 0, blank: 0 }, rows: [] }) })
    await act(async () => { await usePartyImportStore.getState().start() }); await flush()
    expect(document.body.textContent).toContain('Choose the column that holds the party name')
    expect(btn('Import').disabled).toBe(true)
    await act(async () => { await usePartyImportStore.getState().commit() })
    expect(api.commit).not.toHaveBeenCalled()
  })

  it('Undo this import calls undo, reports it and refreshes the page', async () => {
    const changed = vi.fn(); usePartyImportStore.setState({ onChanged: changed })
    await act(async () => { await usePartyImportStore.getState().start() }); await flush()
    await click(btn('Import 2 parties'))
    await click(btn('Undo this import'))
    expect(api.undo).toHaveBeenCalledWith('imp1')
    expect(document.body.textContent).toContain('Import undone: 2 removed, 0 restored')
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('a failing file shows the message and keeps the dialog usable; Esc closes', async () => {
    api.preview!.mockResolvedValueOnce({ ok: false, error: { code: 'VALIDATION', message: 'That file could not be read as a spreadsheet' } })
    await act(async () => { await usePartyImportStore.getState().start() }); await flush()
    expect(usePartyImportStore.getState().error).toContain('could not be read')
    await act(async () => { await usePartyImportStore.getState().start() }); await flush()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => { document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('is registered: palette action + Ctrl+Shift+J, no key conflict', () => {
    expect(ACTIONS.some((a) => a.id === 'partyImport.open')).toBe(true)
    const b = SHORTCUTS.filter((x) => x.keys === 'Ctrl+Shift+J')
    expect(b).toHaveLength(1); expect(b[0]!.action).toBe('partyImport.open')
  })
})
