// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Create from '../../../pages/Create'
import { useBillStore } from '../../../stores/billStore'
import { usePartyUiStore } from '../../../stores/partyUiStore'
import { usePartyIndexStore } from '../../../stores/partyIndexStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { SAMPLE_PARTIES } from '@shared/party/sampleParties'
import { isNewParty, type PartyLite } from '@shared/party/partyLite'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PARTIES: PartyLite[] = SAMPLE_PARTIES.map((p, i) => ({ id: `p${i}`, ...p }))
let host: HTMLDivElement
let root: Root
const S = () => useBillStore.getState()

function mount(): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(createElement(Create)) })
}
beforeEach(() => {
  useBillStore.setState({ billId: null })
  usePartyUiStore.setState({ addressOpen: false })
  useGridUiStore.setState({ mode: 'idle', armed: false, notice: '' })
  usePartyIndexStore.getState().setParties(PARTIES)
})
afterEach(() => { act(() => root.unmount()); host.remove(); usePartyIndexStore.getState().setParties([]) })

const field = (n: string) => host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-party-field="${n}"]`)!
const list = () => host.querySelector<HTMLElement>('[role=listbox]')
const options = () => [...host.querySelectorAll<HTMLElement>('[role=option]')]
const optNames = () => options().map((o) => o.querySelector('.q3-pac__n')!.textContent)
function type(el: HTMLInputElement, value: string): void {
  act(() => {
    el.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  el.setSelectionRange(value.length, value.length)
}
function key(el: Element, k: string, m: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { el.dispatchEvent(ev) })
  return ev
}

describe('Phase 26 — party autocomplete in the party bar', () => {
  it('no list until something is typed; typing shows fuzzy matches with phone/transport; the input is a combobox', () => {
    mount()
    expect(list()).toBeNull()
    expect(field('name').getAttribute('role')).toBe('combobox')
    expect(field('name').getAttribute('aria-expanded')).toBe('false')
    type(field('name') as HTMLInputElement, 'Lakshmi Cloth')
    expect(list()).not.toBeNull()
    expect(optNames().slice(0, 2)).toEqual(['Lakshmi Cloth Stores', 'Lakshmi Clothing Co'])
    expect(optNames()).toContain('Laxmi Cloth House')
    expect(options()[0]!.querySelector('.q3-pac__m')!.textContent).toBe('98450 11001 · VRL Logistics')
    expect(field('name').getAttribute('aria-expanded')).toBe('true')
    expect(field('name').getAttribute('aria-controls')).toBe(list()!.id)
  })

  it('a typo still finds the party; a brand-new name shows no list', () => {
    mount()
    type(field('name') as HTMLInputElement, 'Rubi Trader')
    expect(optNames()[0]).toBe('Ruby Traders')
    type(field('name') as HTMLInputElement, 'Zzqxj Enterprises')
    expect(list()).toBeNull()
  })

  it('phone digits find the party', () => {
    mount()
    type(field('name') as HTMLInputElement, '98860 22002')
    expect(optNames()).toEqual(['Tomato Garments'])
  })

  it('Down opens/moves the highlight, Up moves back and wraps, aria-activedescendant follows; Enter picks the highlighted party', () => {
    mount()
    const name = field('name') as HTMLInputElement
    type(name, 'Lakshmi')
    expect(options().some((o) => o.getAttribute('aria-selected') === 'true')).toBe(false) // nothing highlighted yet
    key(name, 'ArrowDown')
    expect(options()[0]!.getAttribute('aria-selected')).toBe('true')
    expect(name.getAttribute('aria-activedescendant')).toBe(options()[0]!.id)
    key(name, 'ArrowDown')
    expect(options()[1]!.getAttribute('aria-selected')).toBe('true')
    key(name, 'ArrowUp')
    key(name, 'ArrowUp') // wraps to the last row
    expect(options()[options().length - 1]!.getAttribute('aria-selected')).toBe('true')
    key(name, 'ArrowDown') // wraps back to 0
    const ev = key(name, 'Enter')
    expect(ev.defaultPrevented).toBe(true)
    expect(S().party).toEqual({ name: 'Lakshmi Cloth Stores', phone: '98450 11001', address: 'Gandhi Bazaar, Bengaluru', transport: 'VRL Logistics' })
    expect(list()).toBeNull()
    expect(document.activeElement).toBe(field('phone'))
  })

  it('picking fills name, phone, transport AND address as ONE undo step; one Ctrl+Z restores the typed name and blanks', () => {
    mount()
    const name = field('name') as HTMLInputElement
    type(name, 'Ruby')
    const before = S().historyList().length
    key(name, 'ArrowDown'); key(name, 'Enter')
    expect(S().party.name).toBe('Ruby Traders')
    expect(S().historyList().length).toBe(before + 1)
    expect(S().undoLabel).toBe('Selected party Ruby Traders')
    key(field('phone'), 'z', { ctrlKey: true })
    expect(S().party).toEqual({ name: 'Ruby', phone: '', address: '', transport: '' })
    expect(field('name').value).toBe('Ruby')
    key(field('name'), 'y', { ctrlKey: true })
    expect(S().party.address).toBe('Nagarathpet, Bengaluru')
  })

  it('picking replaces details of a previously picked party (no stale phone/address)', () => {
    mount()
    const name = field('name') as HTMLInputElement
    type(name, 'Ruby'); key(name, 'ArrowDown'); key(name, 'Enter')
    type(field('name') as HTMLInputElement, 'Tomato'); key(field('name'), 'ArrowDown'); key(field('name'), 'Enter')
    expect(S().party).toMatchObject({ name: 'Tomato Garments', phone: '98860 22002', address: 'Cottonpet, Bengaluru' })
  })

  it('clicking (mousedown) a row picks it without stealing focus first', () => {
    mount()
    type(field('name') as HTMLInputElement, 'Ganesh')
    const target = options().find((o) => o.textContent!.includes('Sri Ganesha'))!
    const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    act(() => { target.dispatchEvent(md) })
    expect(md.defaultPrevented).toBe(true)
    expect(S().party.name).toBe('Sri Ganesha Sarees')
    expect(list()).toBeNull()
  })

  it('Esc closes the list ONLY (consumed, typed text kept); with the list closed Esc is left for page navigation', () => {
    mount()
    const name = field('name') as HTMLInputElement
    type(name, 'Lakshmi')
    expect(list()).not.toBeNull()
    expect(key(name, 'Escape').defaultPrevented).toBe(true)
    expect(list()).toBeNull()
    expect(S().party.name).toBe('Lakshmi')
    expect(key(name, 'Escape').defaultPrevented).toBe(false)
  })

  it('new-party flow: Enter with nothing highlighted keeps the typed name and moves to Phone; Tab and Right (end edge) do too; nothing is picked', () => {
    mount()
    const name = field('name') as HTMLInputElement
    type(name, 'Lakshmi')
    key(name, 'Enter')
    expect(S().party).toEqual({ name: 'Lakshmi', phone: '', address: '', transport: '' })
    expect(document.activeElement).toBe(field('phone'))
    field('name').focus()
    key(field('name'), 'Tab')
    expect(document.activeElement).toBe(field('phone'))
    field('name').focus()
    ;(field('name') as HTMLInputElement).setSelectionRange(7, 7)
    key(field('name'), 'ArrowRight')
    expect(document.activeElement).toBe(field('phone'))
    expect(S().party.phone).toBe('')
  })

  it('a typed name that is not a saved party is detected as new; a picked one is not', () => {
    mount()
    type(field('name') as HTMLInputElement, 'Totally New Co')
    expect(isNewParty(S().party.name, usePartyIndexStore.getState().parties)).toBe(true)
    type(field('name') as HTMLInputElement, 'Ruby'); key(field('name'), 'ArrowDown'); key(field('name'), 'Enter')
    expect(isNewParty(S().party.name, usePartyIndexStore.getState().parties)).toBe(false)
  })

  it('the list hides when the only match is exactly what is typed; closes on blur; Alt+Down still opens the address (not the list)', () => {
    mount()
    const name = field('name') as HTMLInputElement
    type(name, 'Ruby Traders')
    expect(list()).toBeNull()
    type(name, 'Lakshmi')
    expect(list()).not.toBeNull()
    act(() => { name.blur() })
    expect(list()).toBeNull()
    name.focus()
    type(name, 'Lakshmi')
    key(name, 'ArrowDown', { altKey: true })
    expect(field('address')).not.toBeNull()
    expect(list()).toBeNull()
  })

  it('Down with an empty name does nothing and is not swallowed into a list', () => {
    mount()
    const name = field('name') as HTMLInputElement
    name.focus()
    expect(key(name, 'ArrowDown').defaultPrevented).toBe(false)
    expect(list()).toBeNull()
  })

  it('works with no saved parties (empty index): typing is plain, flow unchanged', () => {
    usePartyIndexStore.getState().setParties([])
    mount()
    type(field('name') as HTMLInputElement, 'Anything')
    expect(list()).toBeNull()
    key(field('name'), 'Enter')
    expect(document.activeElement).toBe(field('phone'))
  })

  it('the index is loaded from the bridge once when the bar mounts (and a missing bridge is harmless)', async () => {
    usePartyIndexStore.setState({ loaded: false, parties: [] })
    let calls = 0
    ;(window as unknown as { quot3: unknown }).quot3 = { parties: { list: async () => { calls++; return { ok: true, data: PARTIES.slice(0, 3) } } } }
    mount()
    await act(async () => { await Promise.resolve() })
    expect(calls).toBe(1)
    expect(usePartyIndexStore.getState().parties).toHaveLength(3)
    delete (window as unknown as { quot3?: unknown }).quot3
    await usePartyIndexStore.getState().load() // no bridge: untouched
    expect(usePartyIndexStore.getState().parties).toHaveLength(3)
  })
})

describe('Phase 145 — party list shows full names', () => {
  const LONG = 'Shri Venkateshwara Traders and General Merchants Private Limited, Main Road Branch'
  it('a very long party name is present in full in its list row', () => {
    usePartyIndexStore.getState().setParties([{ id: 'long1', name: LONG, phone: '', transport: '', address: '' } as PartyLite])
    mount()
    type(field('name') as HTMLInputElement, 'Shri Venkat')
    expect(optNames()).toContain(LONG)
  })
  it('the list CSS wraps names (no ellipsis / nowrap on the name) and sizes to content within a cap', () => {
    const css = readFileSync(resolve(__dirname, '../../../styles/grid.css'), 'utf8')
    const rule = (sel: string): string => css.split('\n').find((l) => l.startsWith(sel + ' {')) ?? ''
    const name = rule('.q3-pac__n')
    expect(name).not.toContain('text-overflow')
    expect(name).not.toContain('nowrap')
    expect(name).toContain('white-space: normal')
    const box = rule('.q3-pac')
    expect(box).toContain('width: max-content')
    expect(box).toContain('max-width: min(60ch')
  })
})
