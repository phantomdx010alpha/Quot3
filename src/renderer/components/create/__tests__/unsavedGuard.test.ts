// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Create from '../../../pages/Create'
import { UnsavedDialog } from '../UnsavedDialog'
import { useHotkeys } from '../../../hooks/useHotkeys'
import { useAppActions } from '../../../hooks/useAppActions'
import { useDirtyGuard } from '../../../hooks/useDirtyGuard'
import { useBillStore } from '../../../stores/billStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { useGuardStore } from '../../../stores/guardStore'
import { usePartyIndexStore } from '../../../stores/partyIndexStore'
import { usePartyUiStore } from '../../../stores/partyUiStore'
import { useSaveUiStore } from '../../../stores/saveUiStore'
import { createSession, openBillForEdit } from '../../../stores/createSession'
import { historyHooks } from '../../../stores/historyHooks'
import { useRouter } from '../../../router/routerStore'
import { createEmptyBill } from '@shared/billModel'
import { currentPath, initialNav, ROUTES } from '@shared/routes'
import { row } from '@shared/__fixtures__/bills'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const S = () => useBillStore.getState()
const path = () => currentPath(useRouter.getState().nav)
const dialog = () => document.querySelector<HTMLElement>('[role=dialog]')
let quitCb: (() => void) | null = null
let save: ReturnType<typeof vi.fn>
let confirmQuit: ReturnType<typeof vi.fn>
let getForEdit: ReturnType<typeof vi.fn>
const today = new Date().toISOString().slice(0, 10)

function Shell(): React.JSX.Element {
  useHotkeys([], useAppActions())
  useDirtyGuard()
  const onCreate = currentPath(useRouter((s) => s.nav)) === ROUTES.create // like the real shell: the page unmounts when you leave it
  return createElement('div', null, onCreate ? createElement(Create) : null, createElement(UnsavedDialog))
}
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
function key(k: string, m: Partial<KeyboardEventInit> = {}, target?: Element): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { (target ?? document.activeElement ?? document.body).dispatchEvent(ev) })
  return ev
}
const firstRowId = () => S().rows[0]!.id
function makeDirty(withParty = true): void {
  act(() => {
    if (withParty) S().setPartyField('name', 'Ruby')
    S().setCellText(firstRowId(), 'name', 'Pen')
    S().setCellText(firstRowId(), 'qty', '2')
  })
}

beforeEach(async () => {
  quitCb = null
  save = vi.fn(async () => ({ ok: true, data: { id: S().billId, poNumber: 'Q3-0001', poSeq: 1, revision: 1, partyId: 'p1', createdAt: 'c', updatedAt: 'u' } }))
  confirmQuit = vi.fn(async () => ({ ok: true, data: {} }))
  getForEdit = vi.fn()
  ;(window as unknown as { quot3: unknown }).quot3 = {
    bills: { save, getForEdit, newDefaults: async () => ({ ok: true, data: { formatId: 'non_gst', billDate: today, branchId: 'local', nextPoPreview: 'Q3-0001' } }) },
    parties: { list: async () => ({ ok: true, data: [] }) },
    app: { confirmQuit },
    on: (_c: string, cb: () => void) => { quitCb = cb; return () => { quitCb = null } }
  }
  createSession.set(null)
  useBillStore.setState({ billId: null })
  useGuardStore.setState({ open: false, saved: false, busy: false, pending: null })
  useGridUiStore.setState({ mode: 'idle', armed: false, notice: '' })
  usePartyUiStore.setState({ addressOpen: false })
  usePartyIndexStore.getState().setParties([])
  useSaveUiStore.setState({ saving: false, last: null })
  act(() => { useRouter.setState({ nav: initialNav(ROUTES.dashboard), navCount: 0 }) })
  act(() => { useRouter.getState().navigate(ROUTES.create) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(createElement(Shell)) })
  await flush()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  delete (window as unknown as { quot3?: unknown }).quot3
})

describe('Phase 28 — unsaved-changes guard', () => {
  it('a clean (untouched) new bill leaves silently on Esc and via the side-rail route', () => {
    key('Escape', {}, document.body)
    expect(dialog()).toBeNull()
    expect(path()).toBe(ROUTES.dashboard)
    act(() => { useRouter.getState().navigate(ROUTES.create) })
    act(() => { useRouter.getState().navigate(ROUTES.history) })
    expect(dialog()).toBeNull()
    expect(path()).toBe(ROUTES.history)
  })

  it('Esc on a dirty new bill opens "Save this bill?" and stays on Create', () => {
    makeDirty()
    key('Escape', {}, document.body)
    expect(path()).toBe(ROUTES.create)
    expect(dialog()?.textContent).toContain('Save this bill?')
  })

  it('every way out of Create is guarded: back, side-rail navigation', () => {
    makeDirty()
    act(() => { useRouter.getState().navigate(ROUTES.history) })
    expect(dialog()).not.toBeNull()
    expect(path()).toBe(ROUTES.create)
  })

  it('Esc in the dialog cancels: still on Create, bill untouched and dirty, dialog gone', () => {
    makeDirty()
    key('Escape', {}, document.body)
    key('Escape', {}, dialog()!)
    expect(dialog()).toBeNull()
    expect(path()).toBe(ROUTES.create)
    expect(S().dirty).toBe(true)
    expect(S().party.name).toBe('Ruby')
    expect(path()).toBe(ROUTES.create)
  })

  it('D discards: leaves, and coming back opens an EMPTY bill', () => {
    makeDirty()
    const oldId = S().billId
    key('Escape', {}, document.body)
    key('d', {}, dialog()!.querySelector('[data-guard-keys]')!)
    expect(dialog()).toBeNull()
    expect(path()).toBe(ROUTES.dashboard)
    act(() => { useRouter.getState().navigate(ROUTES.create) })
    expect(S().billId).not.toBe(oldId)
    expect(S().party.name).toBe('')
    expect(S().dirty).toBe(false)
  })

  it('S saves then leaves; the bill is clean', async () => {
    makeDirty()
    key('Escape', {}, document.body)
    key('s', {}, dialog()!.querySelector('[data-guard-keys]')!)
    await flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect(dialog()).toBeNull()
    expect(path()).toBe(ROUTES.dashboard)
    expect(S().dirty).toBe(false)
  })

  it('Save with no party name: the dialog closes, we stay, Party name is focused, nothing is saved', async () => {
    makeDirty(false)
    key('Escape', {}, document.body)
    key('s', {}, dialog()!.querySelector('[data-guard-keys]')!)
    await flush()
    expect(save).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()
    expect(path()).toBe(ROUTES.create)
    expect(document.activeElement).toBe(host.querySelector('[data-party-field="name"]'))
  })

  it('a failed save keeps you on the page with the bill intact', async () => {
    save.mockResolvedValueOnce({ ok: false, error: { code: 'DB_ERROR', message: 'disk full' } })
    makeDirty()
    key('Escape', {}, document.body)
    key('s', {}, dialog()!.querySelector('[data-guard-keys]')!)
    await flush()
    expect(path()).toBe(ROUTES.create)
    expect(S().dirty).toBe(true)
  })

  it('undoing back to the opened state removes the prompt', () => {
    makeDirty()
    act(() => { while (S().canUndo) S().undo() })
    expect(S().dirty).toBe(false)
    key('Escape', {}, document.body)
    expect(dialog()).toBeNull()
    expect(path()).toBe(ROUTES.dashboard)
  })

  it('a saved bill with new edits says "Save changes?"; clean again right after saving', async () => {
    makeDirty()
    await act(async () => { key('s', { ctrlKey: true }, document.body) })
    await flush()
    expect(S().dirty).toBe(false)
    key('Escape', {}, document.body)
    expect(dialog()).toBeNull() // saved and untouched → leaves silently
    // Phase 70: a saved bill is NOT resumed — Create is blank when you come back (see the Phase 70 describe below).
    act(() => { useRouter.getState().navigate(ROUTES.create) })
    expect(S().poNumber).toBe('')
    expect(S().party.name).toBe('')
  })

  it('editing again right after a save (no leaving) says \"Save changes?\"', async () => {
    makeDirty()
    await act(async () => { key('s', { ctrlKey: true }, document.body) })
    await flush()
    act(() => { S().setCellText(firstRowId(), 'rate', '9') })
    key('Escape', {}, document.body)
    expect(dialog()?.textContent).toContain('Save changes?')
  })

  it('typed-but-uncommitted cell text counts as a change (the draft is flushed before asking)', () => {
    const flushSpy = vi.fn(() => { act(() => { S().setCellText(firstRowId(), 'name', 'Draft') }) })
    const hooks = historyHooks
    hooks.selection = { flush: flushSpy, get: () => null, restore: () => undefined } as never
    key('Escape', {}, document.body)
    expect(flushSpy).toHaveBeenCalled()
    expect(dialog()).not.toBeNull()
    hooks.selection = null
  })

  it('Ctrl+N on a clean bill starts a new one (new id) on Create', () => {
    const id = S().billId
    key('n', { ctrlKey: true }, document.body)
    expect(S().billId).not.toBe(id)
    expect(path()).toBe(ROUTES.create)
  })

  it('Ctrl+N on a dirty bill asks first; Discard gives a fresh empty bill on the same page', () => {
    makeDirty()
    key('n', { ctrlKey: true }, document.body)
    expect(dialog()).not.toBeNull()
    key('d', {}, dialog()!.querySelector('[data-guard-keys]')!)
    expect(path()).toBe(ROUTES.create)
    expect(S().party.name).toBe('')
    expect(S().dirty).toBe(false)
  })

  it('closing the window: clean → confirmQuit straight away; dirty → dialog, Discard then confirms', async () => {
    expect(quitCb).not.toBeNull()
    act(() => { quitCb!() })
    expect(confirmQuit).toHaveBeenCalledTimes(1)
    makeDirty()
    act(() => { quitCb!() })
    expect(confirmQuit).toHaveBeenCalledTimes(1)
    expect(dialog()).not.toBeNull()
    key('Escape', {}, dialog()!) // cancel: window stays open
    expect(confirmQuit).toHaveBeenCalledTimes(1)
    act(() => { quitCb!() })
    key('d', {}, dialog()!.querySelector('[data-guard-keys]')!)
    expect(confirmQuit).toHaveBeenCalledTimes(2)
  })

  it('openBillForEdit loads a saved bill clean on Create; editing it then prompts', async () => {
    const saved = { ...createEmptyBill({ branchId: 'b', rowCount: 0 }), id: 'saved-1', poNumber: 'Q3-0007', poSeq: 7, revision: 3, party: { name: 'Tomato', phone: '', address: '', transport: '' }, rows: [row('Pen', '1', '5')] }
    getForEdit.mockResolvedValueOnce({ ok: true, data: saved })
    act(() => { useRouter.getState().navigate(ROUTES.dashboard) })
    await act(async () => { expect(await openBillForEdit('saved-1')).toBe(true) })
    expect(path()).toBe(ROUTES.create)
    expect(S()).toMatchObject({ billId: 'saved-1', poNumber: 'Q3-0007', dirty: false })
    expect(S().meta.revision).toBe(3)
    expect(S().party.name).toBe('Tomato')
    act(() => { S().setCellText(S().rows[0]!.id, 'rate', '6') })
    key('Escape', {}, document.body)
    expect(dialog()?.textContent).toContain('Save changes?')
  })

  it('openBillForEdit returns false and changes nothing when the bill cannot be read', async () => {
    getForEdit.mockResolvedValueOnce({ ok: false, error: { code: 'NOT_FOUND', message: 'x' } })
    const id = S().billId
    await act(async () => { expect(await openBillForEdit('nope')).toBe(false) })
    expect(S().billId).toBe(id)
  })
})

describe('Phase 70 — Create after Save is blank; an unsaved bill resumes; New starts fresh', () => {
  it('after a successful save, leaving and opening Create gives a blank bill (new id, no party, clean)', async () => {
    makeDirty()
    const savedId = S().billId
    await act(async () => { key('s', { ctrlKey: true }, document.body) })
    await flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect(createSession.get()).toBeNull()
    act(() => { useRouter.getState().navigate(ROUTES.dashboard) })
    act(() => { useRouter.getState().navigate(ROUTES.create) })
    expect(S().billId).not.toBe(savedId)
    expect(S().party.name).toBe('')
    expect(S().poNumber).toBe('')
    expect(S().dirty).toBe(false)
  })

  it('saving does not reload or navigate the bill that is on screen', async () => {
    makeDirty()
    const savedId = S().billId
    await act(async () => { key('s', { ctrlKey: true }, document.body) })
    await flush()
    expect(path()).toBe(ROUTES.create)
    expect(S().billId).toBe(savedId)
    expect(S().party.name).toBe('Ruby')
  })

  it('Phase 118 (supersedes the Phase 70 resume): leave Create without the guard, come back: a NEW blank bill', () => {
    makeDirty()
    const id = S().billId
    act(() => { useRouter.setState({ nav: initialNav(ROUTES.dashboard), navCount: 0 }) }) // leave Create without going through the guard (the page just unmounts)
    act(() => { useRouter.getState().navigate(ROUTES.create) })
    expect(S().billId).not.toBe(id) // Phase 118: the session ended when Create was left, so coming back opened a new bill
    expect(S().party.name).toBe('')
  })

  it('Phase 118: typing again after a save does NOT re-arm the session (Create always opens blank)', async () => {
    makeDirty()
    await act(async () => { key('s', { ctrlKey: true }, document.body) })
    await flush()
    expect(createSession.get()).toBeNull()
    act(() => { S().setCellText(firstRowId(), 'rate', '9') })
    expect(createSession.get()).toBeNull()
  })

  it('the bottom bar has a visible New bill button: clean = fresh bill at once; dirty = asks first', () => {
    const btn = host.querySelector<HTMLButtonElement>('button[aria-label="New bill"]')
    expect(btn).not.toBeNull()
    const id = S().billId
    act(() => { btn!.click() })
    expect(S().billId).not.toBe(id)
    expect(path()).toBe(ROUTES.create)
    makeDirty()
    act(() => { host.querySelector<HTMLButtonElement>('button[aria-label="New bill"]')!.click() })
    expect(dialog()?.textContent).toContain('Save this bill?')
  })
})
