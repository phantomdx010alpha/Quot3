// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Create from '../../../pages/Create'
import { useBillStore } from '../../../stores/billStore'
import { usePartyUiStore } from '../../../stores/partyUiStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { createEmptyBill } from '@shared/billModel'
import { runUndo } from '../../../stores/undoActions'
import { allActions, matchShortcut, SHORTCUTS } from '@shared/shortcuts'
import { ROUTES } from '@shared/routes'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const S = () => useBillStore.getState()

function mount(): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(createElement(Create)) })
}
beforeEach(() => { useBillStore.setState({ billId: null }) /* the page keeps its own bill across mounts; start each test fresh */; usePartyUiStore.setState({ addressOpen: false }); useGridUiStore.setState({ mode: 'idle', armed: false, notice: '' }) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const field = (n: string) => host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-party-field="${n}"]`)!
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  act(() => {
    el.focus()
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  if (el instanceof HTMLInputElement && el.type === 'text') el.setSelectionRange(value.length, value.length)
}
function key(el: Element, k: string, m: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { el.dispatchEvent(ev) })
  return ev
}

describe('Phase 25 — party/detail bar', () => {
  it('the Create page opens a fresh bill with the bar, toolbars, grid and bottom bar', () => {
    mount()
    expect(host.querySelector('.q3-pbar')).not.toBeNull()
    expect(host.querySelector('[role=grid]')).not.toBeNull()
    expect(host.querySelector('.q3-bbar')).not.toBeNull()
    expect(S().billId).not.toBeNull()
    expect(S().party).toEqual({ name: '', phone: '', address: '', transport: '' })
    // the address field is collapsed behind the pull-down
    expect(host.querySelector('[data-party-field="address"]')).toBeNull()
    expect(host.querySelector('.q3-pbar__addr')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('typing writes to the store (sanitised); the bar shows the store values', () => {
    mount()
    type(field('name'), 'Ruby Traders')
    type(field('phone'), '98450 12345')
    type(field('transport'), 'VRL')
    expect(S().party).toMatchObject({ name: 'Ruby Traders', phone: '98450 12345', transport: 'VRL' })
    act(() => { S().setPartyField('name', 'A\nB') })
    expect(field('name').value).toBe('A B')
  })

  it('Right at the end edge moves Name → Phone → Transport; mid-text Right does not', () => {
    mount()
    type(field('name'), 'Ruby')
    field('name').setSelectionRange(2, 2)
    expect(key(field('name'), 'ArrowRight').defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(field('name'))
    field('name').setSelectionRange(4, 4)
    expect(key(field('name'), 'ArrowRight').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(field('phone'))
    key(field('phone'), 'ArrowRight') // empty field: caret is at the end
    expect(document.activeElement).toBe(field('transport'))
  })

  it('Tab / Shift+Tab / Enter walk the fields; from Transport Tab and Enter drop into the grid at row 1 / Item Name', () => {
    mount()
    field('name').focus()
    key(field('name'), 'Tab')
    expect(document.activeElement).toBe(field('phone'))
    key(field('phone'), 'Enter')
    expect(document.activeElement).toBe(field('transport'))
    key(field('transport'), 'Tab', { shiftKey: true })
    expect(document.activeElement).toBe(field('phone'))
    key(field('phone'), 'Tab', { shiftKey: true })
    expect(document.activeElement).toBe(field('name'))
    field('transport').focus()
    key(field('transport'), 'Tab')
    let active = host.querySelector('.q3-gc[data-active]')
    expect(active?.getAttribute('data-col')).toBe('name')
    expect(active?.closest('[data-row-id]')?.getAttribute('data-row-id')).toBe(S().view.navIds[0])
    // Enter does the same
    field('transport').focus()
    key(field('transport'), 'Enter')
    active = host.querySelector('.q3-gc[data-active]')
    expect(active?.getAttribute('data-col')).toBe('name')
  })

  it('Alt+Down opens the address pull-down and focuses it; Esc closes it and returns to the field; Alt+Up too; Esc elsewhere is left alone', () => {
    mount()
    field('transport').focus()
    expect(key(field('transport'), 'Escape').defaultPrevented).toBe(false) // closed: Esc is for page navigation
    key(field('transport'), 'ArrowDown', { altKey: true })
    expect(field('address')).not.toBeNull()
    expect(document.activeElement).toBe(field('address'))
    type(field('address'), '12 Main St\nBengaluru')
    expect(S().party.address).toBe('12 Main St\nBengaluru')
    expect(key(field('address'), 'Escape').defaultPrevented).toBe(true)
    expect(host.querySelector('[data-party-field="address"]')).toBeNull()
    expect(document.activeElement).toBe(field('transport'))
    expect(host.querySelector('.q3-pbar__addr')?.getAttribute('data-filled')).toBe('1')
    key(field('transport'), 'ArrowDown', { altKey: true })
    key(field('address'), 'ArrowUp', { altKey: true })
    expect(host.querySelector('[data-party-field="address"]')).toBeNull()
  })

  it('the chevron button toggles the pull-down and is out of the Tab order', () => {
    mount()
    const btn = host.querySelector<HTMLButtonElement>('.q3-pbar__addr')!
    expect(btn.tabIndex).toBe(-1)
    act(() => { btn.click() })
    expect(field('address')).not.toBeNull()
    act(() => { host.querySelector<HTMLButtonElement>('.q3-pbar__addr')!.click() })
    expect(host.querySelector('[data-party-field="address"]')).toBeNull()
  })

  it('undo / redo work from inside a field and restore the party value (one entry per burst)', () => {
    mount()
    type(field('name'), 'R')
    type(field('name'), 'Ru')
    type(field('name'), 'Ruby')
    expect(S().undoLabel).toBe('Edited Party name')
    const ev = key(field('name'), 'z', { ctrlKey: true })
    expect(ev.defaultPrevented).toBe(true) // native input undo suppressed
    expect(S().party.name).toBe('')
    expect(field('name').value).toBe('')
    key(field('name'), 'y', { ctrlKey: true })
    expect(S().party.name).toBe('Ruby')
    key(field('name'), 'z', { ctrlKey: true, shiftKey: true }) // Ctrl+Shift+Z is the other redo; here it follows an undo-less state
    expect(S().party.name).toBe('Ruby')
  })

  it('a different field is a different undo entry; the unsaved marker follows the party fields', () => {
    mount()
    expect(S().dirty).toBe(false)
    type(field('name'), 'Ruby')
    type(field('phone'), '123')
    expect(S().dirty).toBe(true)
    expect(S().historyList().map((h) => h.label)).toEqual(['Edited Party name', 'Edited Phone'])
    act(() => { S().undo() })
    expect(S().party).toMatchObject({ name: 'Ruby', phone: '' })
    act(() => { S().undo() })
    expect(S().dirty).toBe(false)
    act(() => { S().redo(); S().redo() })
    expect(S().party).toMatchObject({ name: 'Ruby', phone: '123' })
  })

  it('the date is undoable, rejects invalid dates, and Enter drops into the grid', () => {
    mount()
    const d = field('date') as HTMLInputElement
    const before = S().billDate
    type(d, '2026-02-29')
    expect(S().billDate).toBe(before) // not a real date → rejected
    type(d, '2026-03-01')
    expect(S().billDate).toBe('2026-03-01')
    expect(S().undoLabel).toBe('Changed date')
    act(() => { S().undo() })
    expect(S().billDate).toBe(before)
    d.focus()
    key(d, 'Enter')
    expect(host.querySelector('.q3-gc[data-active]')).not.toBeNull()
  })

  it('revert to last saved restores party and date', () => {
    mount()
    type(field('name'), 'Ruby')
    act(() => { S().setBillDate('2026-03-01') })
    act(() => { S().revertToSaved() })
    expect(S().party.name).toBe('')
    expect(S().billDate).not.toBe('2026-03-01')
  })

  it('the PO number is a read-only preview (a span, not an input) and shows the bill\'s own number once it has one', () => {
    mount()
    const po = host.querySelector('[data-testid=po-preview]')!
    expect(po.tagName).toBe('SPAN')
    const bill = createEmptyBill({ branchId: 'x', rowCount: 0 })
    bill.poNumber = 'Q3-0042'
    act(() => { S().loadBill(bill) })
    expect(host.querySelector('[data-testid=po-preview]')?.textContent).toBe('Q3-0042')
  })

  it('shows the format indicator and keeps the party bar on a single row (no wrapping container)', () => {
    mount()
    expect(host.querySelector('.q3-pbar .q3-fmtsw')).not.toBeNull()
    expect(host.querySelectorAll('.q3-pbar__row')).toHaveLength(1)
  })

  it('registers the actions + keys and reaches them through the registry', () => {
    const ids = allActions().map((a) => a.id)
    for (const id of ['create.focusParty', 'create.focusDate', 'create.address', 'create.addressClose']) expect(ids).toContain(id)
    expect(SHORTCUTS.find((s) => s.action === 'create.address')?.keys).toBe('Alt+ArrowDown')
    const ev = new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true })
    expect(matchShortcut(ev, ['global'])?.action).toBe('create.focusParty')
    expect(ROUTES.create).toBe('/create')
  })

  it('the global ports focus the name / date and open the address from anywhere', () => {
    mount()
    act(() => { usePartyUiStore.getState().focusParty?.() })
    expect(document.activeElement).toBe(field('name'))
    act(() => { usePartyUiStore.getState().focusDate?.() })
    expect(document.activeElement).toBe(field('date'))
    act(() => { usePartyUiStore.getState().openAddress?.() })
    expect(document.activeElement).toBe(field('address'))
    act(() => { usePartyUiStore.getState().closeAddress?.() })
    expect(host.querySelector('[data-party-field="address"]')).toBeNull()
  })

  it('leaving Create clears the ports and the open state', () => {
    mount()
    act(() => { usePartyUiStore.getState().openAddress?.() })
    act(() => root.unmount())
    expect(usePartyUiStore.getState().focusParty).toBeNull()
    expect(usePartyUiStore.getState().addressOpen).toBe(false)
    root = createRoot(host) // so afterEach can unmount
  })
})

// Phase 149 - Stock transfer: "Select branch for transfer" replaces the party fields (design 1.5).
describe('Phase 149 - branch picker on a Stock transfer', () => {
  const picker = () => host.querySelector<HTMLSelectElement>('[data-testid="branch-picker"]')
  const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
  const withBranches = (): void => {
    ;(window as unknown as { quot3: unknown }).quot3 = {
      history: { branches: async () => ({ ok: true, data: [{ id: 'a', name: 'Main', isLocal: true }, { id: 'b', name: 'Hubli', isLocal: false }, { id: 'c', name: 'hubli', isLocal: false }] }) }
    }
  }
  afterEach(() => { delete (window as unknown as { quot3?: unknown }).quot3 })

  it('a quotation format keeps the party fields and no picker', () => {
    mount()
    expect(picker()).toBeNull()
    expect(field('name')).not.toBeNull()
    expect(field('phone')).not.toBeNull()
  })

  it('Stock transfer shows the picker instead of party name / phone / transport / address; date, PO and format stay', async () => {
    withBranches()
    mount()
    act(() => { S().setFormatId('stock_transfer') })
    await flush()
    expect(picker()).not.toBeNull()
    expect(host.querySelector('.q3-pbar')?.textContent).toContain('Select branch for transfer')
    expect(host.querySelector('[data-party-field="phone"]')).toBeNull()
    expect(host.querySelector('[data-party-field="transport"]')).toBeNull()
    expect(host.querySelector('.q3-pbar__addr')).toBeNull()
    expect(host.querySelector('[data-party-field="date"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="po-preview"]')).not.toBeNull()
    expect(host.querySelector('.q3-fmtsw')).not.toBeNull()
    // the list is the branch list, de-duplicated by name (case-insensitive), plus the blank prompt
    expect([...picker()!.options].map((o) => o.value)).toEqual(['', 'Main', 'Hubli'])
  })

  it('choosing a branch writes it to the bill (one undoable edit) and Enter hands the keyboard to the grid', async () => {
    withBranches()
    mount()
    act(() => { S().setFormatId('stock_transfer') })
    await flush()
    const el = picker()!
    act(() => {
      el.focus()
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, 'Hubli')
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(S().party.name).toBe('Hubli')
    expect(picker()!.value).toBe('Hubli')
    const ev = key(picker()!, 'Enter')
    expect(ev.defaultPrevented).toBe(true)
    act(() => { runUndo() })
    expect(S().party.name).toBe('')
  })

  it('a branch name that is no longer in the list stays selectable (never silently dropped)', async () => {
    withBranches()
    mount()
    act(() => { S().setFormatId('stock_transfer'); S().setPartyField('name', 'Old branch') })
    await flush()
    expect(picker()!.value).toBe('Old branch')
  })

  it('switching back to a quotation format brings the party fields back with the same name; no data is lost', async () => {
    withBranches()
    mount()
    act(() => { S().setFormatId('stock_transfer'); S().setPartyField('name', 'Hubli') })
    await flush()
    act(() => { S().setFormatId('non_gst') })
    expect(picker()).toBeNull()
    expect(field('name').value).toBe('Hubli')
  })
})
