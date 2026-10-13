// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Create from '../../../pages/Create'
import { useHotkeys } from '../../../hooks/useHotkeys'
import { useAppActions } from '../../../hooks/useAppActions'
import { useBillStore } from '../../../stores/billStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { usePartyIndexStore } from '../../../stores/partyIndexStore'
import { usePartyUiStore } from '../../../stores/partyUiStore'
import { useSaveUiStore } from '../../../stores/saveUiStore'
import { useRouter } from '../../../router/routerStore'
import { runSave } from '../../../stores/saveActions'
import { ROUTES } from '@shared/routes'
import { ACTIONS, matchShortcut } from '@shared/shortcuts'
import type { SaveBillResponse } from '@shared/ipc'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const today = new Date().toISOString().slice(0, 10)
let host: HTMLDivElement
let root: Root
const S = () => useBillStore.getState()

interface Fake {
  save: ReturnType<typeof vi.fn>
  newDefaults: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
}
let fake: Fake
let revision = 0

function installBridge(over: { save?: (input: unknown) => Promise<unknown>; defaults?: Record<string, string> } = {}): void {
  revision = 0
  fake = {
    save: vi.fn(over.save ?? (async () => {
      revision += 1
      const data: SaveBillResponse = { id: S().billId ?? 'x', poNumber: 'Q3-0001', poSeq: 1, revision, partyId: 'party-1', createdAt: '2026-10-08T10:00:00.000Z', updatedAt: '2026-10-08T10:00:0' + revision + '.000Z' }
      return { ok: true, data }
    })),
    newDefaults: vi.fn(async () => ({ ok: true, data: { formatId: 'non_gst', billDate: today, branchId: 'local', nextPoPreview: 'Q3-0001', ...over.defaults } })),
    list: vi.fn(async () => ({ ok: true, data: [] }))
  }
  ;(window as unknown as { quot3: unknown }).quot3 = { bills: { save: fake.save, newDefaults: fake.newDefaults }, parties: { list: fake.list } }
}

function Shell(): React.JSX.Element {
  const actions = useAppActions()
  useHotkeys([], actions)
  return createElement(Create)
}
async function mount(): Promise<void> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(createElement(Shell)) })
}
beforeEach(async () => {
  useBillStore.setState({ billId: null })
  useGridUiStore.setState({ mode: 'idle', armed: false, notice: '' })
  usePartyUiStore.setState({ addressOpen: false })
  usePartyIndexStore.getState().setParties([])
  useSaveUiStore.setState({ saving: false, last: null })
  act(() => { useRouter.getState().navigate(ROUTES.create) })
  installBridge()
})
afterEach(() => {
  if (root) act(() => root.unmount())
  host?.remove()
  delete (window as unknown as { quot3?: unknown }).quot3
})

function key(k: string, m: Partial<KeyboardEventInit> = {}, target?: Element): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { (target ?? document.activeElement ?? document.body).dispatchEvent(ev) })
  return ev
}
const ctrlS = (target?: Element) => key('s', { ctrlKey: true }, target)
const firstRowId = () => S().rows[0]!.id
function fillBill(name = 'Ruby Traders'): void {
  act(() => {
    S().setPartyField('name', name)
    S().setCellText(firstRowId(), 'name', 'Pen')
    S().setCellText(firstRowId(), 'qty', '10')
    S().setCellText(firstRowId(), 'rate', '9')
  })
}
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve() }) }

describe('Phase 27 — Ctrl+S save flow', () => {
  it('Ctrl+S is a registered global shortcut with a palette entry', () => {
    expect(ACTIONS.some((a) => a.id === 'bill.save' && a.label === 'Save bill')).toBe(true)
    expect(matchShortcut(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }), [])?.action).toBe('bill.save')
  })

  it('a new Create page takes the local branch id / date / format from bills:newDefaults (only when something differs)', async () => {
    installBridge({ defaults: { branchId: 'branch-real', billDate: '2026-01-02' } })
    await mount()
    await flush()
    expect(fake.newDefaults).toHaveBeenCalledTimes(1)
    expect(S().meta.branchId).toBe('branch-real')
    expect(S().billDate).toBe('2026-01-02')
    expect(S().dirty).toBe(false)
  })

  it('no party name: nothing is sent, the Party name field gets focus, a message explains', async () => {
    await mount()
    act(() => { S().setCellText(firstRowId(), 'name', 'Pen'); S().setCellText(firstRowId(), 'qty', '1') })
    ctrlS(document.body)
    await flush()
    expect(fake.save).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(host.querySelector('[data-party-field="name"]'))
    expect(useGridUiStore.getState().notice).toMatch(/party name/i)
    expect(useSaveUiStore.getState().last).toMatchObject({ tone: 'warn' })
  })

  it('a name but no item/adjustment rows: nothing is sent and the message says so', async () => {
    await mount()
    act(() => { S().setPartyField('name', 'Ruby') })
    ctrlS(document.body)
    await flush()
    expect(fake.save).not.toHaveBeenCalled()
    expect(useGridUiStore.getState().notice).toMatch(/at least one item/i)
  })

  it('success: sends the trimmed bill (no padding rows, tidy party), shows the PO number, clears dirty, keeps undo, reloads parties', async () => {
    await mount()
    fillBill('  Ruby Traders  ')
    expect(S().dirty).toBe(true)
    expect(S().rows.length).toBeGreaterThan(1) // grid padding exists in the store
    const listCallsBefore = fake.list.mock.calls.length
    ctrlS(document.body)
    await flush()
    expect(fake.save).toHaveBeenCalledTimes(1)
    const sent = fake.save.mock.calls[0]![0] as { bill: { id: string; party: { name: string }; rows: { nameRuns: unknown[] }[] }; expectedRevision?: number }
    expect(sent.bill.party.name).toBe('Ruby Traders')
    expect(sent.bill.rows).toHaveLength(1)
    expect(sent).not.toHaveProperty('expectedRevision') // a brand-new bill
    expect(S().poNumber).toBe('Q3-0001')
    expect(S().meta).toMatchObject({ revision: 1, poSeq: 1, partyId: 'party-1' })
    expect(S().party.name).toBe('Ruby Traders') // store tidied too
    expect(S().dirty).toBe(false)
    expect(S().canUndo).toBe(true) // history survives a save (D-U2)
    expect(host.textContent).toContain('Q3-0001')
    expect(useGridUiStore.getState().notice).toBe('Saved Q3-0001')
    expect(useSaveUiStore.getState().last).toMatchObject({ tone: 'ok', message: 'Saved Q3-0001' })
    expect(fake.list.mock.calls.length).toBeGreaterThan(listCallsBefore) // party index reloaded after the save
  })

  it('editing after a save marks the bill dirty again; the next Ctrl+S sends expectedRevision and bumps the revision', async () => {
    await mount()
    fillBill()
    ctrlS(document.body)
    await flush()
    expect(S().dirty).toBe(false)
    act(() => { S().setCellText(firstRowId(), 'rate', '11') })
    expect(S().dirty).toBe(true)
    ctrlS(document.body)
    await flush()
    expect(fake.save).toHaveBeenCalledTimes(2)
    expect((fake.save.mock.calls[1]![0] as { expectedRevision?: number }).expectedRevision).toBe(1)
    expect(S().meta.revision).toBe(2)
    expect(S().poNumber).toBe('Q3-0001')
    expect(S().dirty).toBe(false)
  })

  it('works from inside the grid (focused cell) and the keypress is consumed', async () => {
    await mount()
    fillBill()
    const grid = host.querySelector<HTMLElement>('[role=grid]')!
    act(() => { grid.focus() })
    const cell = document.activeElement!
    expect(cell.closest('.q3-grid')).not.toBeNull()
    const e = ctrlS(cell)
    await flush()
    expect(e.defaultPrevented).toBe(true)
    expect(fake.save).toHaveBeenCalledTimes(1)
  })

  it('a stale revision (CONFLICT_REVISION) leaves the bill dirty and unchanged and tells the owner', async () => {
    await mount()
    fillBill()
    ctrlS(document.body)
    await flush()
    installBridge({ save: async () => ({ ok: false, error: { code: 'CONFLICT_REVISION', message: 'changed' } }) })
    act(() => { S().setCellText(firstRowId(), 'rate', '12') })
    ctrlS(document.body)
    await flush()
    expect(S().dirty).toBe(true)
    expect(S().meta.revision).toBe(1)
    expect(useGridUiStore.getState().notice).toMatch(/changed elsewhere/i)
    expect(useSaveUiStore.getState().last).toMatchObject({ tone: 'danger' })
  })

  it('any other failure keeps the bill dirty, shows the reason, and the saving flag is released', async () => {
    await mount()
    installBridge({ save: async () => ({ ok: false, error: { code: 'DB_ERROR', message: 'Database is read-only' } }) })
    fillBill()
    ctrlS(document.body)
    await flush()
    expect(S().dirty).toBe(true)
    expect(S().poNumber).toBe('')
    expect(useGridUiStore.getState().notice).toMatch(/read-only/)
    expect(useSaveUiStore.getState().saving).toBe(false)
  })

  it('a thrown bridge error is reported, not swallowed, and does not wedge the save button', async () => {
    await mount()
    installBridge({ save: async () => { throw new Error('boom') } })
    fillBill()
    const out = await act(async () => runSave())
    expect(out).toMatchObject({ ok: false, reason: 'error' })
    expect(useSaveUiStore.getState().saving).toBe(false)
    expect(S().dirty).toBe(true)
  })

  it('a second Ctrl+S while a save is in flight is ignored (one request)', async () => {
    await mount()
    let release: (v: unknown) => void = () => undefined
    installBridge({ save: () => new Promise((r) => { release = r }) })
    fillBill()
    ctrlS(document.body)
    ctrlS(document.body)
    expect(fake.save).toHaveBeenCalledTimes(1)
    await act(async () => { release({ ok: true, data: { id: S().billId, poNumber: 'Q3-0001', poSeq: 1, revision: 1, partyId: 'p', createdAt: 'c', updatedAt: 'u' } }) })
    expect(S().poNumber).toBe('Q3-0001')
  })

  it('Ctrl+S on another page does nothing', async () => {
    await mount()
    fillBill()
    act(() => { useRouter.getState().navigate(ROUTES.history) })
    ctrlS(document.body)
    await flush()
    expect(fake.save).not.toHaveBeenCalled()
  })

  it('no bridge: runSave reports it instead of throwing', async () => {
    await mount()
    delete (window as unknown as { quot3?: unknown }).quot3
    fillBill()
    const out = await act(async () => runSave())
    expect(out).toMatchObject({ ok: false, reason: 'no-bridge' })
  })

  it('an undo entry exists for the party tidy-up only when something needed trimming', async () => {
    await mount()
    fillBill('Ruby Traders') // already tidy
    const before = S().historyList().length
    ctrlS(document.body)
    await flush()
    expect(S().historyList().length).toBe(before)
  })
})
