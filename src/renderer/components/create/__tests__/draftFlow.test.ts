// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Create from '../../../pages/Create'
import Dashboard from '../../../pages/Dashboard'
import { UnsavedDialog } from '../UnsavedDialog'
import { useHotkeys } from '../../../hooks/useHotkeys'
import { useAppActions } from '../../../hooks/useAppActions'
import { useDirtyGuard } from '../../../hooks/useDirtyGuard'
import { useDrafts } from '../../../hooks/useDrafts'
import { useBillStore } from '../../../stores/billStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { useGuardStore } from '../../../stores/guardStore'
import { usePartyIndexStore } from '../../../stores/partyIndexStore'
import { usePartyUiStore } from '../../../stores/partyUiStore'
import { useSaveUiStore } from '../../../stores/saveUiStore'
import { useDraftStore } from '../../../stores/draftStore'
import { draftAutosaveIdle, resetDraftAutosave } from '../../../stores/draftAutosave'
import { createSession } from '../../../stores/createSession'
import { runUndo } from '../../../stores/undoActions'
import { runSave } from '../../../stores/saveActions'
import { useRouter } from '../../../router/routerStore'
import { createEmptyBill } from '@shared/billModel'
import { buildDraftPayload, parseDraftPayload, summarizeDraft } from '@shared/draft'
import { currentPath, initialNav, ROUTES } from '@shared/routes'
import { row } from '@shared/__fixtures__/bills'
import type { Bill } from '@shared/types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const S = () => useBillStore.getState()
const path = () => currentPath(useRouter.getState().nav)
const dialog = () => document.querySelector<HTMLElement>('[role=dialog]')
const today = new Date().toISOString().slice(0, 10)

/** The fake main process: an in-memory `drafts` table + `bills:getForEdit` + save. */
interface DraftRow { id: string; billId: string | null; payload: string; updatedAt: string }
let table: Map<string, DraftRow>
let savedBills: Map<string, Bill>
let fake: { save: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn>; billSave: ReturnType<typeof vi.fn> }
let eventCb: ((p: unknown) => void) | null = null

function installBridge(): void {
  table = new Map()
  savedBills = new Map()
  eventCb = null
  fake = {
    save: vi.fn(async (i: { draftId: string; billId?: string; payload: string }) => { table.set(i.draftId, { id: i.draftId, billId: i.billId ?? null, payload: i.payload, updatedAt: '2026-10-08T10:00:00.000Z' }); return { ok: true, data: { draftId: i.draftId, updatedAt: '2026-10-08T10:00:00.000Z' } } }),
    list: vi.fn(async () => ({ ok: true, data: [...table.values()].map((r) => summarizeDraft({ id: r.id, billId: r.billId, payloadJson: r.payload, updatedAt: r.updatedAt })).filter(Boolean) })),
    get: vi.fn(async (id: string) => {
      const r = table.get(id)
      if (!r) return { ok: false, error: { code: 'NOT_FOUND', message: 'That unsaved bill no longer exists' } }
      const p = parseDraftPayload(r.payload)
      return p.ok ? { ok: true, data: { id: r.id, billId: r.billId, updatedAt: r.updatedAt, bill: p.bill } } : { ok: false, error: { code: 'DB_ERROR', message: 'unreadable' } }
    }),
    del: vi.fn(async (id: string) => ({ ok: true, data: { deleted: table.delete(id) } })),
    billSave: vi.fn(async () => ({ ok: true, data: { id: S().billId, poNumber: 'Q3-0001', poSeq: 1, revision: 1, partyId: 'p1', createdAt: 'c', updatedAt: 'u' } }))
  }
  ;(window as unknown as { quot3: unknown }).quot3 = {
    drafts: { save: fake.save, list: fake.list, get: fake.get, delete: fake.del },
    bills: {
      save: fake.billSave,
      getForEdit: async (id: string) => { const b = savedBills.get(id); return b ? { ok: true, data: b } : { ok: false, error: { code: 'NOT_FOUND', message: 'gone' } } },
      newDefaults: async () => ({ ok: true, data: { formatId: 'non_gst', billDate: today, branchId: 'local', nextPoPreview: 'Q3-0001' } })
    },
    parties: { list: async () => ({ ok: true, data: [] }) },
    app: { confirmQuit: async () => ({ ok: true, data: {} }), getInfo: async () => ({ ok: true, data: { devMode: false } }) },
    on: (c: string, cb: (p: unknown) => void) => { if (c === 'drafts:recoverable') eventCb = cb; return () => { eventCb = null } }
  }
}

function Shell(): React.JSX.Element {
  useHotkeys([], useAppActions())
  useDirtyGuard()
  useDrafts()
  const p = currentPath(useRouter((s) => s.nav))
  return createElement('div', null, p === ROUTES.create ? createElement(Create) : p === ROUTES.dashboard ? createElement(Dashboard) : null, createElement(UnsavedDialog))
}
const flush = async (): Promise<void> => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }) }
async function settle(): Promise<void> { await act(async () => { await draftAutosaveIdle(); await Promise.resolve() }) }
function key(k: string, m: Partial<KeyboardEventInit> = {}, target?: Element): void {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { (target ?? document.activeElement ?? document.body).dispatchEvent(ev) })
}
const firstRowId = () => S().rows[0]!.id
function makeDirty(name = 'Ruby'): void {
  act(() => { S().setPartyField('name', name); S().setCellText(firstRowId(), 'name', 'Pen'); S().setCellText(firstRowId(), 'qty', '2') })
}
async function tick(ms: number): Promise<void> { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

async function mountAt(route: string): Promise<void> {
  act(() => { useRouter.setState({ nav: initialNav(ROUTES.dashboard), navCount: 0 }) })
  if (route !== ROUTES.dashboard) act(() => { useRouter.getState().navigate(route) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(createElement(Shell)) })
  await flush()
}

beforeEach(() => {
  installBridge()
  resetDraftAutosave()
  createSession.set(null)
  useBillStore.setState({ billId: null })
  useGuardStore.setState({ open: false, saved: false, busy: false, pending: null })
  useGridUiStore.setState({ mode: 'idle', armed: false, notice: '' })
  usePartyUiStore.setState({ addressOpen: false })
  usePartyIndexStore.getState().setParties([])
  useSaveUiStore.setState({ saving: false, last: null })
  useDraftStore.setState({ drafts: [], loaded: false, message: '', wantFocus: false })
})
afterEach(() => {
  vi.useRealTimers()
  if (root) act(() => root.unmount())
  host?.remove()
  document.body.innerHTML = ''
  delete (window as unknown as { quot3?: unknown }).quot3
})

describe('Phase 29 — autosave', () => {
  it('waits ~2 s after the last change, then writes ONE draft (id = bill id) with the typed state', async () => {
    await mountAt(ROUTES.create)
    vi.useFakeTimers()
    makeDirty('Ruby Traders')
    await tick(1900)
    expect(fake.save).not.toHaveBeenCalled()
    await tick(200)
    await settle()
    expect(fake.save).toHaveBeenCalledTimes(1)
    const call = fake.save.mock.calls[0]![0] as { draftId: string; billId?: string; payload: string }
    expect(call.draftId).toBe(S().billId)
    expect(call.billId).toBeUndefined() // never saved → not an edit of a saved bill
    const p = parseDraftPayload(call.payload)
    expect(p.ok && p.bill.party.name).toBe('Ruby Traders')
    expect(p.ok && p.bill.rows).toHaveLength(1) // padding rows are not stored
  })

  it('keeps pushing the write back while changes keep coming (debounce) and then updates the SAME row', async () => {
    await mountAt(ROUTES.create)
    vi.useFakeTimers()
    makeDirty()
    await tick(1500)
    act(() => { S().setPartyField('phone', '98450') })
    await tick(1500)
    expect(fake.save).not.toHaveBeenCalled()
    await tick(600)
    await settle()
    expect(fake.save).toHaveBeenCalledTimes(1)
    act(() => { S().setPartyField('transport', 'VRL') })
    await tick(2100)
    await settle()
    expect(fake.save).toHaveBeenCalledTimes(2)
    expect(table.size).toBe(1)
    const p = parseDraftPayload([...table.values()][0]!.payload)
    expect(p.ok && p.bill.party.transport).toBe('VRL')
  })

  it('a pristine bill never gets a draft', async () => {
    await mountAt(ROUTES.create)
    vi.useFakeTimers()
    await tick(5000)
    await settle()
    expect(fake.save).not.toHaveBeenCalled()
    expect(fake.del).not.toHaveBeenCalled()
  })

  it('undoing back to the saved state removes the draft (a clean bill has none)', async () => {
    await mountAt(ROUTES.create)
    vi.useFakeTimers()
    act(() => { S().setPartyField('name', 'Ruby') })
    await tick(2100)
    await settle()
    expect(table.size).toBe(1)
    act(() => { runUndo() })
    expect(S().dirty).toBe(false)
    await tick(2100)
    await settle()
    expect(table.size).toBe(0)
  })

  it('saving the bill deletes its draft and cancels a pending write', async () => {
    await mountAt(ROUTES.create)
    vi.useFakeTimers()
    makeDirty()
    await tick(2100)
    await settle()
    expect(table.size).toBe(1)
    act(() => { S().setPartyField('phone', '1') }) // a write is now pending
    await act(async () => { await runSave() })
    await settle()
    expect(table.size).toBe(0)
    await tick(5000)
    await settle()
    expect(table.size).toBe(0)
    expect(fake.save).toHaveBeenCalledTimes(1)
  })

  it('Discard (Esc → D) deletes the draft and it does not come back', async () => {
    await mountAt(ROUTES.create)
    vi.useFakeTimers()
    makeDirty()
    await tick(2100)
    await settle()
    expect(table.size).toBe(1)
    key('Escape', {}, document.body)
    expect(dialog()).not.toBeNull()
    key('d', {}, dialog()!.querySelector('[data-guard-keys]')!)
    await settle()
    expect(table.size).toBe(0)
    await tick(5000)
    await settle()
    expect(table.size).toBe(0)
  })

  it('editing a SAVED bill stores the draft with its bill id', async () => {
    await mountAt(ROUTES.create)
    vi.useFakeTimers()
    makeDirty()
    await act(async () => { await runSave() }) // now a saved bill with a PO number
    expect(S().poNumber).toBe('Q3-0001')
    act(() => { S().setPartyField('phone', '555') })
    await tick(2100)
    await settle()
    const call = fake.save.mock.calls.at(-1)![0] as { draftId: string; billId?: string }
    expect(call.billId).toBe(S().billId)
  })

  it('a failing bridge never throws into the app; the next change retries', async () => {
    await mountAt(ROUTES.create)
    vi.useFakeTimers()
    fake.save.mockRejectedValueOnce(new Error('disk full'))
    makeDirty()
    await tick(2100)
    await settle()
    expect(table.size).toBe(0)
    act(() => { S().setPartyField('phone', '1') })
    await tick(2100)
    await settle()
    expect(table.size).toBe(1)
  })
})

describe('Phase 29 — recovery on the Dashboard', () => {
  function seedDraft(over: Partial<Bill> = {}, billId: string | null = null): Bill {
    const b: Bill = { ...createEmptyBill({ branchId: 'local', rowCount: 0 }), party: { name: 'Ruby Traders', phone: '98450', address: '', transport: 'VRL' }, rows: [row('Pen', '2', '3'), row('Book', '1', '40')], ...over }
    table.set(b.id, { id: b.id, billId, payload: JSON.stringify(buildDraftPayload(b)), updatedAt: new Date().toISOString() })
    return b
  }

  it('lists the surviving draft as "Recover unsaved bill — party, time"', async () => {
    seedDraft()
    await mountAt(ROUTES.dashboard)
    const box = document.querySelector('[data-testid=draft-recovery]')
    expect(box).not.toBeNull()
    expect(box!.textContent).toContain('Recover unsaved bill — Ruby Traders, today')
  })

  it('shows nothing when there are no drafts', async () => {
    await mountAt(ROUTES.dashboard)
    expect(document.querySelector('[data-testid=draft-recovery]')).toBeNull()
  })

  it('the drafts:recoverable event fills the banner', async () => {
    await mountAt(ROUTES.dashboard)
    const b = seedDraft()
    const row0 = table.get(b.id)!
    act(() => { eventCb?.({ drafts: [summarizeDraft({ id: row0.id, billId: null, payloadJson: row0.payload, updatedAt: row0.updatedAt })] }) })
    expect(document.querySelector('[data-testid=draft-recovery]')!.textContent).toContain('Ruby Traders')
  })

  it('Recover opens the bill on Create: content restored, DIRTY, with a FRESH undo history', async () => {
    const b = seedDraft()
    await mountAt(ROUTES.dashboard)
    const btn = document.querySelector<HTMLButtonElement>('[data-draft-id]')!
    await act(async () => { btn.click() })
    await flush()
    expect(path()).toBe(ROUTES.create)
    expect(S().billId).toBe(b.id)
    expect(S().party).toMatchObject({ name: 'Ruby Traders', phone: '98450', transport: 'VRL' })
    expect(S().rows[0]).toMatchObject({ qty: '2', rate: '3' })
    expect(S().rows[1]).toMatchObject({ qty: '1', rate: '40' })
    expect(S().dirty).toBe(true)
    expect(S().canUndo).toBe(false)
    expect(S().historyList().length).toBe(0)
    expect(S().poNumber).toBe('')
  })

  it('a recovered bill is guarded: Esc asks Save / Discard, and Discard removes the draft for good', async () => {
    const b = seedDraft()
    await mountAt(ROUTES.dashboard)
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-draft-id]')!.click() })
    await flush()
    key('Escape', {}, document.body)
    expect(dialog()).not.toBeNull()
    key('d', {}, dialog()!.querySelector('[data-guard-keys]')!)
    await settle()
    expect(path()).toBe(ROUTES.dashboard)
    expect(table.has(b.id)).toBe(false)
    await flush()
    expect(document.querySelector('[data-testid=draft-recovery]')).toBeNull()
  })

  it('recovered bill keeps autosaving to the SAME draft row; undo cannot go before the recovery point', async () => {
    const b = seedDraft()
    await mountAt(ROUTES.dashboard)
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-draft-id]')!.click() })
    await flush()
    vi.useFakeTimers()
    act(() => { S().setPartyField('phone', '77777') })
    await tick(2100)
    await settle()
    expect(table.size).toBe(1)
    expect(parseDraftPayload(table.get(b.id)!.payload).ok).toBe(true)
    const p = parseDraftPayload(table.get(b.id)!.payload)
    expect(p.ok && p.bill.party.phone).toBe('77777')
    act(() => { runUndo() })
    expect(S().party.phone).toBe('98450') // back to the recovered state, not to an empty bill
    expect(S().canUndo).toBe(false)
  })

  it('saving a recovered new bill works and removes the draft', async () => {
    const b = seedDraft()
    await mountAt(ROUTES.dashboard)
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-draft-id]')!.click() })
    await flush()
    await act(async () => { await runSave() })
    await settle()
    expect(fake.billSave).toHaveBeenCalledTimes(1)
    expect(S().dirty).toBe(false)
    expect(table.has(b.id)).toBe(false)
  })

  it('recovering an EDIT of a saved bill restores the edit, keeps the PO/revision and is dirty against the stored bill', async () => {
    const stored: Bill = { ...createEmptyBill({ branchId: 'local', rowCount: 0 }), poNumber: 'Q3-0042', poSeq: 42, revision: 3, partyId: 'p1', party: { name: 'Ruby Traders', phone: '', address: '', transport: '' }, rows: [row('Pen', '2', '3')] }
    savedBills.set(stored.id, stored)
    seedDraft({ ...stored, party: { ...stored.party, phone: 'edited' }, rows: [row('Pen', '9', '3')] }, stored.id)
    await mountAt(ROUTES.dashboard)
    expect(document.querySelector('[data-testid=draft-recovery]')!.textContent).toContain('edit of Q3-0042')
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-draft-id]')!.click() })
    await flush()
    expect(S().poNumber).toBe('Q3-0042')
    expect(S().meta.revision).toBe(3)
    expect(S().rows[0]!.qty).toBe('9')
    expect(S().dirty).toBe(true)
    act(() => { S().revertToSaved() }) // "last saved" = the stored bill
    expect(S().rows[0]!.qty).toBe('2')
    expect(S().party.phone).toBe('')
  })

  it('a draft that cannot be opened keeps you on the Dashboard with a message', async () => {
    seedDraft()
    await mountAt(ROUTES.dashboard)
    table.clear() // gone between listing and opening
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-draft-id]')!.click() })
    await flush()
    expect(path()).toBe(ROUTES.dashboard)
    expect(S().billId).toBeNull()
    expect(useDraftStore.getState().message).toContain('no longer exists')
  })

  it('Discard on the banner asks first; Cancel keeps it, Discard deletes it', async () => {
    const b = seedDraft()
    await mountAt(ROUTES.dashboard)
    const discard = document.querySelector<HTMLButtonElement>('[aria-label^="Discard unsaved bill"]')!
    act(() => { discard.click() })
    expect(dialog()?.textContent).toContain('Discard unsaved bill?')
    key('Escape', {}, dialog()!)
    expect(table.has(b.id)).toBe(true)
    act(() => { discard.click() })
    const confirm = [...dialog()!.querySelectorAll('button')].find((x) => x.textContent === 'Discard')!
    await act(async () => { confirm.click() })
    await flush()
    expect(table.has(b.id)).toBe(false)
    expect(document.querySelector('[data-testid=draft-recovery]')).toBeNull()
  })

  it('palette action "Recover unsaved bill" lands on the Dashboard banner with focus (or says there is nothing)', async () => {
    await mountAt(ROUTES.create)
    await act(async () => { await useDraftStore.getState().showBanner() })
    await flush()
    expect(path()).toBe(ROUTES.dashboard)
    expect(document.querySelector('[data-testid=draft-recovery]')!.textContent).toContain('no unsaved bills')
    act(() => { useRouter.getState().navigate(ROUTES.create) })
    seedDraft()
    await act(async () => { await useDraftStore.getState().showBanner() })
    await flush()
    expect(document.activeElement?.hasAttribute('data-draft-id')).toBe(true)
  })
})
