// @vitest-environment jsdom
import { act, createElement, type FC } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openNewBill, addItemRow, setItemField, addAdjustment, setAdjustment, type EditorState } from '../ui/editor/editorModel'
import { removeRowWithUndo, restoreRemoval } from '../ui/kit/rowUndo'
import { SnackbarHost, useSnackbar, type SnackbarApi } from '../ui/kit/Snackbar'
import { dismissSnack, EMPTY_SNACK, SNACK_MS, showSnack, tickSnack } from '../ui/kit/snackbarModel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | null = null
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ''; vi.useRealTimers() })

describe('snackbar model', () => {
  it('one message at a time; a different message replaces; an identical one never stacks (timer restarts)', () => {
    const a = showSnack(EMPTY_SNACK, { message: 'Item removed', hasUndo: true }, 1000)
    expect(a.current).toMatchObject({ id: 1, message: 'Item removed', hasUndo: true, expiresAt: 1000 + SNACK_MS })
    const same = showSnack(a, { message: 'Item removed', hasUndo: true }, 4000)
    expect(same.current!.id).toBe(1)
    expect(same.current!.expiresAt).toBe(4000 + SNACK_MS)
    expect(same.seq).toBe(1)
    const other = showSnack(same, { message: 'Saved' }, 4100)
    expect(other.current).toMatchObject({ id: 2, message: 'Saved', hasUndo: false })
  })
  it('expires after 6 s and dismisses; unchanged state is the same object', () => {
    const a = showSnack(EMPTY_SNACK, { message: 'x' }, 0)
    expect(tickSnack(a, SNACK_MS - 1)).toBe(a)
    expect(tickSnack(a, SNACK_MS).current).toBeNull()
    expect(dismissSnack(a).current).toBeNull()
    expect(dismissSnack(EMPTY_SNACK)).toBe(EMPTY_SNACK)
    expect(SNACK_MS).toBe(6000)
  })
})

describe('snackbar component', () => {
  let api: SnackbarApi
  const Probe: FC = () => { api = useSnackbar(); return createElement(SnackbarHost, { snack: api }) }
  const mount = (): void => { const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); act(() => root!.render(createElement(Probe))) }

  it('shows one snack, Undo runs the callback once and clears it, identical messages do not stack', () => {
    mount()
    const undo = vi.fn()
    act(() => api.show('Item removed', undo))
    act(() => api.show('Item removed', undo))
    expect(document.querySelectorAll('.q3x-snack')).toHaveLength(1)
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Undo')!
    act(() => btn.click())
    expect(undo).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.q3x-snack')).toBeNull()
  })
  it('goes away by itself after 6 s', () => {
    vi.useFakeTimers()
    mount()
    act(() => api.show('Saved'))
    expect(document.querySelector('.q3x-snack-text')!.textContent).toBe('Saved')
    act(() => { vi.advanceTimersByTime(SNACK_MS + 50) })
    expect(document.querySelector('.q3x-snack')).toBeNull()
  })
})

let n = 0
const nid = (): string => `id${++n}`
function withRows(): { s: EditorState; ids: string[]; adj: string } {
  let s = openNewBill({ branchId: 'b', roundOff: false, today: '2026-10-22', newId: nid })
  const first = s.bill.rows[0]!.id
  s = setItemField(s, first, 'qty', '2')
  const ids = [first]
  for (const name of ['B', 'C']) { const r = addItemRow(s, nid); s = setItemField(r.state, r.id, 'qty', name === 'B' ? '3' : '4'); ids.push(r.id) }
  const a = addAdjustment(s, nid); s = setAdjustment(a.state, a.id, { name: 'Discount', amount: '-10' })
  return { s, ids, adj: a.id }
}

describe('row remove Undo model', () => {
  it('puts the SAME row back at the same place and renumbers', () => {
    const { s, ids } = withRows()
    const before = s.bill.rows.find((r) => r.id === ids[1])!
    const { state, removal } = removeRowWithUndo(s, ids[1]!)
    expect(state.bill.rows.some((r) => r.id === ids[1])).toBe(false)
    const back = restoreRemoval(state, removal!)
    expect(back.bill.rows.map((r) => r.id)).toEqual(s.bill.rows.map((r) => r.id))
    expect(back.bill.rows.map((r) => r.idx)).toEqual(back.bill.rows.map((_, i) => i))
    expect(back.bill.rows.find((r) => r.id === ids[1])).toEqual(before)
  })
  it('keeps edits made after the removal, and a second restore changes nothing', () => {
    const { s, ids } = withRows()
    const { state, removal } = removeRowWithUndo(s, ids[0]!)
    const edited = setItemField(state, ids[2]!, 'qty', '9')
    const back = restoreRemoval(edited, removal!)
    expect(back.bill.rows[0]!.id).toBe(ids[0])
    expect(back.bill.rows.find((r) => r.id === ids[2])!.qty).toBe('9')
    expect(restoreRemoval(back, removal!)).toBe(back)
  })
  it('an adjustment goes back into the adjustments, an unknown id removes nothing', () => {
    const { s, adj } = withRows()
    const { state, removal } = removeRowWithUndo(s, adj)
    expect(state.adjIds).not.toContain(adj)
    const back = restoreRemoval(state, removal!)
    expect(back.adjIds).toEqual([adj])
    expect(back.bill.rows.at(-1)!.id).toBe(adj)
    expect(removeRowWithUndo(s, 'nope')).toEqual({ state: s, removal: null })
  })
  it('the last item row is only blanked; undo puts its content back', () => {
    let s = openNewBill({ branchId: 'b', roundOff: false, today: '2026-10-22', newId: nid })
    const id = s.bill.rows[0]!.id
    s = setItemField(s, id, 'qty', '5')
    const original = s.bill.rows[0]!
    const { state, removal } = removeRowWithUndo(s, id)
    expect(removal!.blanked).toBe(true)
    expect(state.bill.rows[0]!.qty).not.toBe('5')
    expect(restoreRemoval(state, removal!).bill.rows[0]).toEqual(original)
  })
})
