// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DuplicatesPanel } from '../DuplicatesPanel'
import { useDuplicatesStore } from '../../../stores/duplicatesStore'
import type { DuplicateSuggestion } from '@shared/customers/duplicates'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let items: DuplicateSuggestion[]
const party = (id: string, name: string, billCount = 0) => ({ id, name, phone: '', address: '', transport: '', billCount })
const sug = (a: string, b: string): DuplicateSuggestion => ({ survivorId: a, mergedId: b, rule: 'same-core', reason: 'Same name apart from Ltd / Pvt, a plural or punctuation', survivor: party(a, `Name ${a}`, 3), merged: party(b, `Name ${b} Ltd`) })
let api: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  items = [sug('a', 'b'), sug('c', 'd'), sug('e', 'f')]
  api = {
    duplicates: vi.fn(async () => ({ ok: true as const, data: [...items] })),
    merge: vi.fn(async (i: { survivorId: string; mergedId: string }) => { items = items.filter((x) => x.mergedId !== i.mergedId); return { ok: true as const, data: { ...i, billsMoved: 1 } } }),
    notSame: vi.fn(async (i: { aId: string; bId: string }) => { items = items.filter((x) => x.survivorId !== i.aId); return { ok: true as const, data: { ok: true as const } } }),
    undoLastMerge: vi.fn(async () => ({ ok: true as const, data: { undone: 0, billsMoved: 0 } })),
    unify: vi.fn(async () => ({ ok: true as const, data: { groups: 0, merged: 0, billsMoved: 0 } })),
    list: vi.fn(async () => ({ ok: true as const, data: [] }))
  }
  ;(window as unknown as { quot3: unknown }).quot3 = { customers: api }
  useDuplicatesStore.setState({ open: false, status: 'idle', error: '', items: [], index: 0, busy: false })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const openPanel = async (): Promise<HTMLElement> => {
  await act(async () => { root.render(createElement(DuplicatesPanel)) })
  await act(async () => { await useDuplicatesStore.getState().toggle() })
  await flush()
  return host.querySelector('[role="listbox"]') as HTMLElement
}
const key = async (el: Element, k: string): Promise<void> => { await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) }); await flush() }

describe('Possible duplicates panel (Phase 137)', () => {
  it('opens, lists each pair with its reason, and highlights the first', async () => {
    const list = await openPanel()
    const rows = host.querySelectorAll('[role="option"]')
    expect(rows).toHaveLength(3)
    expect(rows[0]!.getAttribute('aria-selected')).toBe('true')
    expect(rows[0]!.textContent).toContain('Same name apart from Ltd')
    expect(list.getAttribute('aria-activedescendant')).toBe('q3-dup-0')
  })
  it('arrow keys move, Enter merges the highlighted pair and the list reloads', async () => {
    const list = await openPanel()
    await key(list, 'ArrowDown')
    expect(useDuplicatesStore.getState().index).toBe(1)
    await key(list, 'Enter')
    expect(api.merge).toHaveBeenCalledWith({ survivorId: 'c', mergedId: 'd' })
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(2)
  })
  it('Not the same removes the pair; Escape closes', async () => {
    const list = await openPanel()
    await act(async () => { await useDuplicatesStore.getState().notSame() })
    expect(api.notSame).toHaveBeenCalledWith({ aId: 'a', bId: 'b' })
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(2)
    await key(list, 'Escape')
    expect(host.querySelector('[role="listbox"]')).toBeNull()
  })
  it('selector stability: moving the highlight keeps the same items array', async () => {
    await openPanel()
    const a = useDuplicatesStore.getState().items
    act(() => { useDuplicatesStore.getState().move(1) })
    expect(useDuplicatesStore.getState().items).toBe(a)
  })
  it('says so when nothing is similar', async () => {
    items = []
    await openPanel()
    expect(host.textContent).toContain('No similar names found')
  })
})
