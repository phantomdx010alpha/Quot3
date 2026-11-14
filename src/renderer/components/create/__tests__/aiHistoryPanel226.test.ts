// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Create from '../../../pages/Create'
import { useHotkeys } from '../../../hooks/useHotkeys'
import { useAppActions } from '../../../hooks/useAppActions'
import { useBillStore } from '../../../stores/billStore'
import { useAiPanelStore } from '../../../stores/aiPanelStore'
import { usePriceStripStore } from '../../../stores/priceStripStore'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const SUG = { nameUsed: 'Ruby Tomato Seeds', formatLabel: 'GST', gst: true, lastRate: '90', lastQty: '12', lastUnit: null, lastDate: '2026-10-03', timesBought: 3, tier: 2, score: 0.9, why: 'looks similar', explanation: 'x' }
const set = vi.fn(async () => ({ ok: true, data: {} }))
const suggestForParty = vi.fn(async () => ({ ok: true, data: { suggestions: [SUG], embeddingsUsed: false } }))
let aiState = 'ready'
let stored: Record<string, unknown> = {}

function Shell(): React.JSX.Element {
  const actions = useAppActions()
  useHotkeys([], actions)
  return createElement(Create)
}
const panel = (): HTMLElement | null => host.querySelector('.q3-aipanel')
const wait = (ms = 220): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
async function key(k: string, m: Partial<KeyboardEventInit> = {}): Promise<void> {
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })) })
}
/** A name cell as the grid renders it, added next to the real grid so the panel's delegated listeners see its events. */
function nameCell(): HTMLElement {
  const gridHost = host.querySelector('.q3-create__grid') as HTMLElement
  const cell = document.createElement('div')
  cell.className = 'q3-gc'; cell.setAttribute('data-col', 'name')
  const span = document.createElement('span'); span.className = 'q3-gc__text'; span.tabIndex = -1
  cell.appendChild(span); gridHost.appendChild(cell)
  return span
}
async function typeIn(el: HTMLElement, text: string): Promise<void> {
  el.focus()
  el.textContent = text
  await act(async () => { el.dispatchEvent(new Event('input', { bubbles: true })) })
}

beforeEach(async () => {
  stored = { 'ai.enabled': true, 'ai.billingPanel': true }
  aiState = 'ready'
  ;(window as unknown as { quot3: unknown }).quot3 = {
    settings: { get: vi.fn(async () => ({ ok: true, data: { value: null } })), set, getAll: vi.fn(async () => ({ ok: true, data: stored })) },
    ai: { status: vi.fn(async () => ({ ok: true, data: { state: aiState } })), suggestForParty }
  }
  useAiPanelStore.setState({ enabled: false, billingPanel: false, status: null, partyId: null, partyName: '', cellActive: false, typed: '', rows: [], seq: 0 })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(createElement(Shell)) })
  await act(async () => { useBillStore.getState().setPartyField('name', 'Invented Traders') })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (window as unknown as { quot3?: unknown }).quot3
  set.mockClear(); suggestForParty.mockClear()
})

describe('billing-screen panel (Phase 226)', () => {
  it('shows the earlier items of the party when the item cell is active and something is typed', async () => {
    const cell = nameCell()
    await typeIn(cell, 'ruby tom')
    await wait()
    expect(panel()).not.toBeNull()
    expect(panel()!.textContent).toContain('Ruby Tomato Seeds')
    expect(panel()!.textContent).toContain('GST')
    expect(panel()!.textContent).toContain('Rate 90')
    expect(panel()!.textContent).toContain('03/10/2026')
    expect(panel()!.textContent).toContain('bought 3 times')
    expect(suggestForParty).toHaveBeenCalledWith({ partyId: null, partyName: 'Invented Traders', text: 'ruby tom' })
  })

  it('is absent when the master or panel switch is off, with no party, or with no active cell', async () => {
    const cell = nameCell()
    await typeIn(cell, 'ruby')
    await wait()
    expect(panel()).not.toBeNull()
    await act(async () => { useAiPanelStore.setState({ billingPanel: false }) })
    expect(panel()).toBeNull()
    await act(async () => { useAiPanelStore.setState({ billingPanel: true, enabled: false }) })
    expect(panel()).toBeNull()
    await act(async () => { useAiPanelStore.setState({ enabled: true }) })
    await act(async () => { useBillStore.getState().setPartyField('name', '') })
    expect(panel()).toBeNull()
  })

  it('hides when nothing matches on a ready model, and shows a quiet note while the model loads', async () => {
    suggestForParty.mockResolvedValue({ ok: true, data: { suggestions: [], embeddingsUsed: false } } as never)
    const cell = nameCell()
    await typeIn(cell, 'zzz')
    await wait()
    expect(panel()).toBeNull()
    aiState = 'loading'
    await typeIn(cell, 'zzzz')
    await wait()
    expect(panel()!.textContent).toBe('AI is loading')
    suggestForParty.mockResolvedValue({ ok: true, data: { suggestions: [SUG], embeddingsUsed: false } } as never)
  })

  it('never takes focus and never moves the grid cursor', async () => {
    const cell = nameCell()
    await typeIn(cell, 'ruby')
    await wait()
    expect(panel()).not.toBeNull()
    expect(document.activeElement).toBe(cell)
    expect(panel()!.querySelectorAll('button, input, [tabindex]').length).toBe(0)
    const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    panel()!.dispatchEvent(md)
    expect(md.defaultPrevented).toBe(true) // a click on the panel cannot steal the caret
    expect(document.activeElement).toBe(cell)
  })

  it('Alt+H toggles the panel switch, writes ai.billingPanel, and the toolbar switch shows the state', async () => {
    useAiPanelStore.setState({ enabled: true, billingPanel: false })
    await key('h', { altKey: true })
    expect(set).toHaveBeenCalledWith('ai.billingPanel', true)
    expect(host.querySelector('.q3-fmtbar ~ button[aria-pressed="true"], .q3-create__tools button[aria-pressed="true"]')).not.toBeNull()
    await key('h', { altKey: true })
    expect(set).toHaveBeenCalledWith('ai.billingPanel', false)
  })

  it('a party change leaves no stale rows', async () => {
    const cell = nameCell()
    await typeIn(cell, 'ruby')
    await wait()
    expect(panel()).not.toBeNull()
    await act(async () => { useBillStore.getState().setPartyField('name', 'Another Party') })
    expect(panel()).toBeNull() // rows dropped at once; the next answer comes after the debounce
  })

  it('the panel never marks the bill dirty', async () => {
    const dirtyBefore = useBillStore.getState().dirty
    const cell = nameCell()
    await typeIn(cell, 'ruby')
    await wait()
    expect(useBillStore.getState().dirty).toBe(dirtyBefore)
  })
})

// ---- Phase 254 (M24): the Create-page AI switch (and the price strip display) are hidden while the master AI switch is off -----------------
const historySwitch = (): HTMLElement | null => [...host.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent ?? '').includes('History AI')) ?? null

describe('AI switch hidden while AI is off (Phase 254)', () => {
  it('the History AI switch is drawn only while ai.enabled is on', async () => {
    await wait()
    expect(historySwitch()).not.toBeNull() // beforeEach saved ai.enabled = true
    await act(async () => { useAiPanelStore.setState({ enabled: false }) })
    expect(historySwitch()).toBeNull()
    await act(async () => { useAiPanelStore.setState({ enabled: true }) })
    expect(historySwitch()).not.toBeNull()
  })

  it('with nothing saved (a fresh install) the page shows no AI switch and no panel', async () => {
    act(() => root.unmount()); host.remove()
    stored = {}
    useAiPanelStore.setState({ enabled: false, billingPanel: false, status: null, partyId: null, partyName: '', cellActive: false, typed: '', rows: [], seq: 0 })
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await act(async () => { root.render(createElement(Shell)) })
    await act(async () => { useBillStore.getState().setPartyField('name', 'Invented Traders') })
    await wait()
    expect(historySwitch()).toBeNull()
    expect(panel()).toBeNull()
    expect(useAiPanelStore.getState()).toMatchObject({ enabled: false, billingPanel: false })
  })

  it('the panel key does nothing while AI is off: no setting is written and the master stays off', async () => {
    await act(async () => { useAiPanelStore.setState({ enabled: false, billingPanel: false }) })
    set.mockClear()
    await act(async () => { useAiPanelStore.getState().toggle() })
    expect(set).not.toHaveBeenCalled()
    expect(useAiPanelStore.getState()).toMatchObject({ enabled: false, billingPanel: false })
  })
})

describe('price strip hidden while AI is off (Phase 254) [A]', () => {
  it('the strip shows with AI on and nothing is drawn with AI off; the Rate switch stays (it is the Price List\'s own setting)', async () => {
    await wait()
    const cur = usePriceStripStore.getState().settings
    await act(async () => { usePriceStripStore.setState({ settings: { ...cur, enabled: true, mode: 'suggest' }, cellActive: true, typed: 'pvc' }) })
    expect(host.querySelector('.q3-pricestrip')).not.toBeNull() // AI on: the quiet notice / match line is drawn
    await act(async () => { useAiPanelStore.setState({ enabled: false }) })
    expect(host.querySelector('.q3-pricestrip')).toBeNull() // AI off: nothing
    expect([...host.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('Rate:'))).toBe(true)
  })
})
