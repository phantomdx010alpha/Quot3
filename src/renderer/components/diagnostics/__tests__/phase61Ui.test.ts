// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CrashNotice } from '../CrashNotice'
import { AuditSection } from '../../settings/AuditSection'
import { ErrorBoundary } from '../../ErrorBoundary'
import { installErrorReporting } from '../../../errorReporting'
import { useAuditStore } from '../../../stores/auditStore'
import { useDiagnosticsStore } from '../../../stores/diagnosticsStore'
import type { AuditItem } from '@shared/audit'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const item = (id: number, summary: string, detailText = ''): AuditItem => ({ id, at: '2026-10-10T10:00:00.000Z', branchId: 'b', branchName: 'Main', entity: 'bill', entityId: 'x', action: 'edit', summary, detailText })
let host: HTMLDivElement
let root: Root
const report = vi.fn(async (_i: { kind: string; message: string; stack?: string }) => ({ ok: true as const, data: { logged: true } }))
const copy = vi.fn(async () => ({ ok: true as const, data: { chars: 10, lines: 4 } }))
const dismissCrash = vi.fn(async () => ({ ok: true as const, data: {} }))
const list = vi.fn(async () => ({ ok: true as const, data: { items: [item(2, 'Edited bill Q3-0001', '{"revision": 2}'), item(1, 'Created bill Q3-0001')], hasMore: false, nextBeforeId: null } }))
const facets = vi.fn(async () => ({ ok: true as const, data: { entities: ['bill'], actions: ['edit'], total: 2, retentionDays: 365 } }))
const setSetting = vi.fn(async () => ({ ok: true as const, data: {} }))

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { quot3: unknown }).quot3 = {
    diagnostics: { report, copy, dismissCrash, crashNotice: async () => ({ ok: true, data: { notice: { at: '2026-10-09T08:00:00.000Z', kind: 'unclean-exit', message: '', version: '0.1.0' } } }) },
    audit: { list, facets },
    settings: { set: setSetting }
  }
  useDiagnosticsStore.setState({ notice: null, loaded: false, message: '', failed: false })
  useAuditStore.setState({ filters: { entity: '', action: '', fromDay: '', toDay: '', search: '' }, items: [], hasMore: false, nextBeforeId: null, facets: null, status: 'idle', error: '', expanded: null })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }

describe('Phase 61 - renderer', () => {
  it('window error and unhandled rejection events reach main (scrubbing happens there)', () => {
    const off = installErrorReporting(window)
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom', error: new Error('boom') }))
    const rej = new Event('unhandledrejection') as Event & { reason: unknown }
    rej.reason = new Error('nope')
    window.dispatchEvent(rej)
    expect(report).toHaveBeenCalledTimes(2)
    expect(report.mock.calls[0]![0]).toMatchObject({ kind: 'error', message: 'Error: boom' })
    expect(report.mock.calls[1]![0]).toMatchObject({ kind: 'rejection', message: 'Error: nope' })
    off()
    window.dispatchEvent(new ErrorEvent('error', { message: 'later' }))
    expect(report).toHaveBeenCalledTimes(2)
  })

  it('the crash notice shows after an unclean exit; Copy diagnostics and Dismiss work', async () => {
    await act(async () => { root.render(createElement(CrashNotice)) })
    await flush()
    expect(host.textContent).toContain('did not close properly')
    const buttons = [...host.querySelectorAll('button')]
    await act(async () => { buttons.find((b) => b.textContent === 'Copy diagnostics')!.click() })
    expect(copy).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('Diagnostics copied')
    await act(async () => { buttons.find((b) => b.textContent === 'Dismiss')!.click() })
    expect(dismissCrash).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-testid="crash-notice"]')).toBeNull()
  })

  it('the Activity log lists entries, expands details and changes retention', async () => {
    await act(async () => { root.render(createElement(AuditSection)) })
    await flush()
    expect(host.textContent).toContain('Edited bill Q3-0001')
    expect(host.textContent).toContain('Created bill Q3-0001')
    await act(async () => { (host.querySelector('button[aria-label="Details of entry 2"]') as HTMLButtonElement).click() })
    expect(host.querySelector('.q3-au__detail')?.textContent).toContain('"revision": 2')
    const sel = host.querySelector('select[id]:last-of-type') as HTMLSelectElement
    const retention = [...host.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent === '2 years'))!
    await act(async () => { retention.value = '730'; retention.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(setSetting).toHaveBeenCalledWith('audit.retentionDays', 730)
    expect(sel).toBeTruthy()
  })

  it('a screen that throws while rendering shows the fallback and reports once', async () => {
    const Bomb = (): never => { throw new Error('render failed') }
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await act(async () => { root.render(createElement(ErrorBoundary, null, createElement(Bomb))) })
    err.mockRestore()
    expect(host.textContent).toContain('Something went wrong on this screen')
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0]![0]).toMatchObject({ kind: 'render' })
  })
})
