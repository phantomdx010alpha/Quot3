// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Create from '../../pages/Create'
import { useBillStore } from '../billStore'
import { createSession, startFreshBill, endSessionAfterSave } from '../createSession'
import { chooseDiscard } from '../guardStore'
import { useRouter } from '../../router/routerStore'
import { createEmptyBill } from '@shared/billModel'
import { initialNav, ROUTES } from '@shared/routes'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const nav = (p: string): void => { act(() => { useRouter.getState().navigate(p) }) }
const back = (): void => { act(() => { useRouter.getState().back() }) }
const mountCreate = (): void => { act(() => root.render(createElement(Create))) }
const unmount = (): void => { act(() => root.render(createElement('div'))) }
/** What the Create page does: mounted only while the route is Create. */
const enter = (path: string = ROUTES.create): void => { nav(path); mountCreate() }
const leave = (to: string): void => { unmount(); nav(to) }
const type = (): string => {
  const s = useBillStore.getState()
  const row = s.rows[0]!
  s.setCellText(row.id, 'name', 'PIN')
  return s.billId!
}
const isBlank = (): boolean => { const s = useBillStore.getState(); return s.rows.every((r) => r.nameRuns.every((x) => x.t === '') && !r.qty && !r.rate) }

beforeEach(() => {
  useBillStore.setState({ billId: null })
  createSession.set(null)
  useRouter.setState({ nav: initialNav(ROUTES.dashboard), navCount: 0 })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Phase 118 - every entry to Create is a clean bill', () => {
  it('first entry: blank', () => {
    enter()
    expect(isBlank()).toBe(true)
    expect(useBillStore.getState().billId).not.toBeNull()
  })
  for (const via of [ROUTES.history, ROUTES.dashboard, ROUTES.settings, ROUTES.customers]) {
    it(`typed bill, leave to ${via}, come back: a NEW blank bill`, () => {
      enter()
      const first = type()
      expect(isBlank()).toBe(false)
      leave(via)
      enter()
      expect(useBillStore.getState().billId).not.toBe(first)
      expect(isBlank()).toBe(true)
    })
  }
  it('late dirty flip after leaving (the old resume trigger) does not make the next entry resume', () => {
    enter()
    const first = type()
    leave(ROUTES.history)
    useBillStore.getState().setCellText(useBillStore.getState().rows[1]!.id, 'name', 'LATE') // a write after leaving
    enter()
    expect(useBillStore.getState().billId).not.toBe(first)
    expect(isBlank()).toBe(true)
  })
  it('Esc / back to Create is blank too', () => {
    enter(ROUTES.history)
    nav(ROUTES.create); mountCreate()
    const first = type()
    leave(ROUTES.history)
    back() // history -> previous entry
    nav(ROUTES.create); mountCreate()
    expect(useBillStore.getState().billId).not.toBe(first)
    expect(isBlank()).toBe(true)
  })
  it('after Save: leaving and returning is blank (the saved bill is not resumed)', () => {
    enter()
    const first = type()
    endSessionAfterSave()
    leave(ROUTES.dashboard)
    enter()
    expect(useBillStore.getState().billId).not.toBe(first)
    expect(isBlank()).toBe(true)
  })
  it('after Discard: blank', () => {
    enter()
    const first = type()
    chooseDiscard()
    leave(ROUTES.dashboard)
    enter()
    expect(useBillStore.getState().billId).not.toBe(first)
    expect(isBlank()).toBe(true)
  })
  it('New bill (Ctrl+N) while on Create: blank, new id', () => {
    enter()
    const first = type()
    act(() => { startFreshBill() })
    expect(useBillStore.getState().billId).not.toBe(first)
    expect(isBlank()).toBe(true)
  })
  it('StrictMode-style double mount does not throw the bill away or keep an old one', () => {
    enter()
    const id = useBillStore.getState().billId
    mountCreate(); unmount(); mountCreate()
    expect(useBillStore.getState().billId).toBe(id) // same visit: kept
  })
})

describe('Phase 118 - deliberately loaded bills are still opened (edit route unchanged)', () => {
  it('a bill loaded for edit before navigating to Create from another page is kept', () => {
    nav(ROUTES.history)
    const bill = { ...createEmptyBill({ branchId: 'local', rowCount: 0 }), id: 'saved-1' }
    useBillStore.getState().loadBill(bill)
    createSession.set('saved-1') // what openBillForEdit does right before navigating
    nav(ROUTES.create); mountCreate()
    expect(useBillStore.getState().billId).toBe('saved-1')
  })
  it('...but leaving and returning without that deliberate load is blank again', () => {
    nav(ROUTES.history)
    useBillStore.getState().loadBill({ ...createEmptyBill({ branchId: 'local', rowCount: 0 }), id: 'saved-2' })
    createSession.set('saved-2')
    nav(ROUTES.create); mountCreate()
    leave(ROUTES.history)
    enter()
    expect(useBillStore.getState().billId).not.toBe('saved-2')
    expect(isBlank()).toBe(true)
  })
})
