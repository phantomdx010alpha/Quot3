// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SentenceChips } from '../SentenceChips'
import { parseSentence } from '@shared/ai/sentenceQuery'
import type { SentenceView } from '@shared/ai/sentenceSearch'
import { captureHistoryContext } from '../../../pageMemory/billContext'
import { useHistoryStore } from '../../../stores/historyStore'
import { usePageMemoryStore } from '../../../stores/pageMemoryStore'
import { ROUTES } from '@shared/routes'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const customers = [{ id: 'p1', name: 'Invented Traders' }, { id: 'p2', name: 'Sample Stores' }, { id: 'p3', name: 'Sample Sweets' }]
const view = (text: string, extra: Partial<SentenceView> = {}): SentenceView => ({ text, chips: parseSentence(text, { today: '2026-11-12', customers }).chips, reranked: false, formatUnknown: 0, ...extra })

let host: HTMLDivElement
let root: Root
let changed: string[]
const mount = (v: SentenceView): void => { act(() => { root.render(createElement(SentenceChips, { view: v, onChange: (t) => changed.push(t) })) }) }
const buttons = (): HTMLButtonElement[] => [...host.querySelectorAll('button')]

beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); changed = [] })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

describe('SentenceChips (Phase 229)', () => {
  it('shows one chip per understood part with its label', () => {
    mount(view('ruby tomato for Invented Traders last month above 5000'))
    const text = host.textContent ?? ''
    expect(text).toContain('Party: Invented Traders')
    expect(text).toContain('Date: ')
    expect(text).toContain('Amount: above 5000')
    expect(text).toContain('Item: ruby tomato')
  })

  it('remove (x) rewrites the sentence without that part', () => {
    mount(view('ruby tomato last month above 5000'))
    act(() => { host.querySelector<HTMLButtonElement>('button[aria-label="Remove date"]')!.click() })
    expect(changed).toEqual(['ruby tomato above 5000'])
  })

  it('clicking a chip lets the owner retype it; Enter applies, Esc cancels', () => {
    mount(view('ruby tomato above 5000'))
    act(() => { buttons().find((b) => b.textContent?.startsWith('Amount'))!.click() })
    const input = host.querySelector<HTMLInputElement>('input.q3-chip__input')!
    expect(input.value).toBe('above 5000')
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => { setValue.call(input, 'under 200'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(changed).toEqual(['ruby tomato under 200'])
    expect(host.querySelector('input.q3-chip__input')).toBeNull()
  })

  it('an ambiguous party offers its choices and picking one rewrites the sentence', () => {
    mount(view('ruby for Sample'))
    act(() => { buttons().find((b) => b.textContent === 'Sample Sweets')!.click() })
    expect(changed).toEqual(['ruby for Sample Sweets'])
  })

  it('notes a model re-order and unknown formats quietly; renders nothing when only item words exist', () => {
    mount(view('ruby last month', { reranked: true, formatUnknown: 2 }))
    expect(host.textContent).toContain('sorted by meaning')
    expect(host.textContent).toContain('Format not known for 2 bills')
    mount(view('ruby tomato'))
    expect(host.querySelector('.q3-hist__chips')).toBeNull()
  })
})

describe('sentence results as the BillContext (Phase 229)', () => {
  it('opening a found bill captures the FOUND list, in its shown order, so PageUp / PageDown step through it', () => {
    const b = (id: string) => ({ id, poNumber: id, poSeq: 1, billDate: '2026-10-01', partyName: 'P', grandTotal: '1', branchId: 'x', revision: 1 })
    useHistoryStore.setState({ query: 'ruby last month', bills: [b('z'), b('y'), b('x')], dates: [], date: null })
    captureHistoryContext('y')
    const ctx = usePageMemoryStore.getState().billContext
    expect(ctx?.sourcePath).toBe(ROUTES.history)
    expect(ctx?.orderedBillIds).toEqual(['z', 'y', 'x'])
    expect(ctx?.currentId).toBe('y')
  })
})
