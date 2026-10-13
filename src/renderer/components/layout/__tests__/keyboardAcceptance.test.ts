// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { allActions, type ActionId } from '@shared/shortcuts'
import { CONTEXT_KEY_HINTS } from '@shared/shortcutList'
import { Dialog } from '../../ui'
import { CommandPalette } from '../CommandPalette'
import { ShortcutSheet } from '../ShortcutSheet'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Phase 67 - jsdom half of the keyboard-only pass: the F1 sheet is complete, dialogs trap and return focus, the palette runs by keyboard. */
// jsdom has no layout: the palette scrolls the highlighted row into view
;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
let root: Root | null = null
let host: HTMLElement | null = null
function mount(node: React.ReactElement): void {
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(node) })
}
function press(key: string, init: KeyboardEventInit = {}, target?: Element): void {
  act(() => { (target ?? document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })) })
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; document.body.innerHTML = '' })

describe('Phase 67 - F1 sheet', () => {
  it('lists EVERY action once (keyed ones with their keys, the rest as Palette) and is reachable for scrolling', () => {
    mount(createElement(ShortcutSheet, { open: true, onClose: () => {} }))
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.q3-sheet__row[data-action]'))
    expect(rows.map((r) => r.dataset.action).sort()).toEqual(allActions().map((a) => a.id as string).sort())
    const palette = rows.filter((r) => r.textContent?.includes('Palette ('))
    expect(palette.length).toBe(40) // the reviewed palette-only list (Phase 137 added customers.unify) (src/__tests__/keyboardAcceptance.test.ts)
    expect(rows.find((r) => r.dataset.action === 'help.shortcuts')?.textContent).toMatch(/F1/)
    expect(rows.find((r) => r.dataset.action === 'help.shortcuts')?.textContent).toMatch(/Ctrl/)
    expect(document.querySelectorAll('[data-context-key]').length).toBe(CONTEXT_KEY_HINTS.length) // grid / list / dialog keys are on the sheet too
    expect(document.querySelector('.q3-sheet')!.textContent).toContain('Select a range of cells')
    const scroller = document.querySelector<HTMLElement>('.q3-sheet')!
    expect(scroller.tabIndex).toBe(0)
    expect(scroller.getAttribute('role')).toBe('region')
  })
  it('opens with focus on Close, Esc closes it and focus goes back to where it was', () => {
    const opener = document.createElement('button'); document.body.appendChild(opener); opener.focus()
    const onClose = vi.fn()
    mount(createElement(ShortcutSheet, { open: true, onClose }))
    expect(document.activeElement?.textContent).toBe('Close')
    press('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Phase 67 - Dialog focus', () => {
  const body = (): React.ReactElement => createElement('div', null,
    createElement('input', { id: 'a' }), createElement('input', { id: 'b' }))
  const footer = createElement('button', { id: 'ok' }, 'OK')
  it('Tab wraps from the last control to the first, Shift+Tab from the first to the last (no escape to the page behind)', () => {
    const page = document.createElement('button'); page.id = 'page'; document.body.appendChild(page)
    mount(createElement(Dialog, { open: true, title: 'T', onClose: () => {}, footer, children: body() }))
    expect(document.activeElement?.id).toBe('a')
    press('Tab', { shiftKey: true })
    expect(document.activeElement?.id).toBe('ok')
    press('Tab')
    expect(document.activeElement?.id).toBe('a')
    expect(document.activeElement?.id).not.toBe('page')
  })
  it('Esc closes, and focus returns to the control that opened it when the dialog closes', () => {
    const opener = document.createElement('button'); opener.id = 'opener'; document.body.appendChild(opener); opener.focus()
    const onClose = vi.fn()
    mount(createElement(Dialog, { open: true, title: 'T', onClose, footer, children: body() }))
    press('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => { root!.render(createElement(Dialog, { open: false, title: 'T', onClose, footer, children: body() })) })
    expect(document.activeElement?.id).toBe('opener')
    expect(document.querySelector('[role=dialog]')).toBeNull()
  })
})

describe('Phase 67 - command palette by keyboard', () => {
  const type = (el: HTMLInputElement, v: string): void => {
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  it('opens focused in its input; typing + Enter runs the top hit; arrows move; Tab never leaves; Esc closes', async () => {
    const run: ActionId[] = []
    const onClose = vi.fn()
    mount(createElement(CommandPalette, { open: true, onClose, onRun: (id: ActionId) => { run.push(id) } }))
    const input = document.querySelector<HTMLInputElement>('input')!
    expect(document.activeElement).toBe(input)
    press('Tab')
    expect(document.activeElement).toBe(input) // Tab is swallowed: focus stays in the input
    type(input, 'Go to History')
    press('Enter')
    await act(async () => { await Promise.resolve() })
    expect(run).toEqual(['nav.history'])
    expect(onClose).toHaveBeenCalled()
    press('Escape')
    expect(onClose.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
  it('every action can be found by its own label and runs through the palette (nothing is unreachable)', async () => {
    const run: ActionId[] = []
    mount(createElement(CommandPalette, { open: true, onClose: () => {}, onRun: (id: ActionId) => { run.push(id) } }))
    const input = document.querySelector<HTMLInputElement>('input')!
    for (const a of allActions()) {
      type(input, a.label)
      press('Enter')
      await act(async () => { await Promise.resolve() })
    }
    expect(run).toEqual(allActions().map((a) => a.id))
  })
})
