// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RevisionPanel } from '../RevisionPanel'
import { useRevisionStore } from '../../../stores/revisionStore'
import { restoreSelectedRevision, toggleRevisions } from '../../../stores/revisionActions'
import { useBillStore } from '../../../stores/billStore'
import { useRouter } from '../../../router/routerStore'
import { useGuardStore } from '../../../stores/guardStore'
import { createSession } from '../../../stores/createSession'
import { useSaveUiStore } from '../../../stores/saveUiStore'
import { currentPath, initialNav, ROUTES } from '@shared/routes'
import type { RevisionSummary } from '@shared/revisions'
import type { Bill, BillRow } from '@shared/types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mkRow = (id: string, name: string, qty: string, rate: string): BillRow => ({ id, idx: 0, nameRuns: [{ t: name }], qty, rate, totalOverride: null, gstRate: null, extras: {} })
const mkBill = (revision: number, rows: BillRow[], partyName = 'Ruby Traders'): Bill => ({
  id: 'b1', branchId: 'local', poSeq: 1, poNumber: 'Q3-0001', partyId: null, party: { name: partyName, phone: '', address: '', transport: '' },
  formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-08', rows: rows.map((r, i) => ({ ...r, idx: i })),
  revision, createdAt: '2026-10-08T10:00:00Z', updatedAt: '2026-10-08T10:00:00Z', deletedAt: null, syncState: 'local_only'
})
const v1 = mkBill(1, [mkRow('r1', 'Pen', '10', '9')])
const v2 = mkBill(2, [mkRow('r1', 'Pen', '12', '9'), mkRow('r2', 'Book', '2', '45')])
const v3 = mkBill(3, [mkRow('r1', 'Pen', '12', '9'), mkRow('r2', 'Book', '2', '45')], 'Ruby Traders Pvt')
const byRev: Record<number, Bill> = { 1: v1, 2: v2, 3: v3 }
const sum = (revision: number, current = false): RevisionSummary => ({ revision, savedAt: `2026-10-0${revision}T10:00:00Z`, savedByBranch: 'local', billDate: '2026-10-08', partyName: 'Ruby Traders', grandTotal: '100.00', itemRowCount: 1, isCurrent: current })

let host: HTMLDivElement
let root: Root
let bridge: { list: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; restoreToDraft: ReturnType<typeof vi.fn> }

const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const key = async (el: Element, k: string): Promise<void> => {
  await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) })
  await flush()
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  bridge = {
    list: vi.fn(async () => ({ ok: true as const, data: [sum(3, true), sum(2), sum(1)] })),
    get: vi.fn(async ({ revision }: { revision: number }) => ({ ok: true as const, data: { revision, savedAt: '', savedByBranch: 'local', bill: byRev[revision]! } })),
    restoreToDraft: vi.fn(async ({ revision }: { revision: number }) => ({ ok: true as const, data: { draft: { ...byRev[revision]!, revision: 3 }, baseline: v3, fromRevision: revision } }))
  }
  ;(window as unknown as { quot3: unknown }).quot3 = { revisions: bridge, bills: { getForEdit: vi.fn(async () => ({ ok: true as const, data: v3 })) } }
  useRouter.setState({ nav: initialNav() })
  useRevisionStore.getState().close()
  useBillStore.getState().loadBill(v3)
  createSession.set(null)
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = '' })

const mount = async (): Promise<void> => { await act(async () => { root.render(createElement(RevisionPanel)) }); await flush() }
const panelText = (): string => document.body.textContent ?? ''

describe('RevisionPanel', () => {
  it('opens on the newest revision showing what that save changed (vs the previous one)', async () => {
    await mount()
    await act(async () => { await useRevisionStore.getState().openFor('b1', 'Q3-0001') })
    await flush()
    expect(bridge.list).toHaveBeenCalledWith({ billId: 'b1' })
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(3)
    expect(panelText()).toContain('Current')
    expect(panelText()).toContain('Party name')
    expect(panelText()).toContain('Ruby Traders Pvt')
  })

  it('Down selects the older revision and shows its changes (row added, qty changed); the oldest says there is nothing earlier', async () => {
    await mount()
    await act(async () => { await useRevisionStore.getState().openFor('b1', 'Q3-0001') })
    const list = document.querySelector<HTMLElement>('[role="listbox"]')!
    await key(list, 'ArrowDown')
    expect(useRevisionStore.getState().selected).toBe(2)
    expect(panelText()).toContain('Added')
    expect(panelText()).toContain('Changed')
    expect(panelText()).toContain('Qty')
    await key(list, 'End')
    expect(useRevisionStore.getState().selected).toBe(1)
    expect(panelText()).toContain('oldest stored revision')
  })

  it('C switches to "changes since" (revision vs the current bill)', async () => {
    await mount()
    await act(async () => { await useRevisionStore.getState().openFor('b1', 'Q3-0001') })
    const list = document.querySelector<HTMLElement>('[role="listbox"]')!
    await key(list, 'End')
    await key(list, 'c')
    expect(useRevisionStore.getState().mode).toBe('current')
    expect(panelText()).toContain('Rows (2)') // revision 1 -> current: Pen qty changed, Book added, plus the party change
    expect(panelText()).toContain('Ruby Traders Pvt')
    await key(list, 'Home')
    expect(panelText()).toContain('current version of the bill')
  })

  it('Enter restores the revision as an UNSAVED change in Create: dirty against the stored bill, same PO number, nothing saved', async () => {
    useRouter.getState().navigate(ROUTES.history)
    await mount()
    await act(async () => { await useRevisionStore.getState().openFor('b1', 'Q3-0001') })
    const list = document.querySelector<HTMLElement>('[role="listbox"]')!
    await key(list, 'End') // revision 1
    await key(list, 'Enter')
    expect(bridge.restoreToDraft).toHaveBeenCalledWith({ billId: 'b1', revision: 1 })
    const s = useBillStore.getState()
    expect(s.dirty).toBe(true)
    expect(s.billId).toBe('b1')
    expect(s.poNumber).toBe('Q3-0001')
    expect(s.meta.revision).toBe(3) // the NEXT save is an edit of the current revision
    expect(s.party.name).toBe('Ruby Traders')
    expect(s.rows.filter((r) => r.qty !== null)).toHaveLength(1)
    expect(createSession.get()).toBe('b1')
    expect(currentPath(useRouter.getState().nav)).toBe(ROUTES.create)
    expect(useRevisionStore.getState().open).toBe(false)
    expect(useSaveUiStore.getState().last?.message).toContain('unsaved change')
  })

  it('restoring the current revision is refused; with unsaved edits the Save / Discard guard comes first', async () => {
    await mount()
    await act(async () => { await useRevisionStore.getState().openFor('b1', 'Q3-0001') })
    expect(restoreSelectedRevision()).toBe(false) // newest = current
    expect(bridge.restoreToDraft).not.toHaveBeenCalled()
    await act(async () => { await useRevisionStore.getState().select(2) })
    useBillStore.getState().setPartyField('name', 'Someone Else') // unsaved edit on the open bill
    expect(restoreSelectedRevision()).toBe(true)
    await flush()
    expect(useGuardStore.getState().open).toBe(true)
    expect(bridge.restoreToDraft).not.toHaveBeenCalled()
    useGuardStore.setState({ open: false, pending: null })
  })

  it('Ctrl+Shift+V target: an unsaved new bill has no revisions (message, nothing opens); the panel toggles closed', async () => {
    useRouter.getState().navigate(ROUTES.create)
    useBillStore.setState({ poNumber: '' })
    expect(toggleRevisions()).toBe(false)
    expect(useRevisionStore.getState().open).toBe(false)
    expect(useSaveUiStore.getState().last?.message).toContain('not been saved')
    useBillStore.setState({ poNumber: 'Q3-0001' })
    expect(toggleRevisions()).toBe(true)
    await flush()
    expect(useRevisionStore.getState().open).toBe(true)
    expect(toggleRevisions()).toBe(true)
    expect(useRevisionStore.getState().open).toBe(false)
  })
})
