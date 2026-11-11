/**
 * Phase 220 (M21): PageUp / PageDown stepping.
 *  - `stepOpenedBill`: in a saved bill opened from a list, show the previous / next bill of that list in the SAME bill view (the stack does not grow).
 *  - `stepParty`: Customers (selection moves), History with a party in focus (the search switches to the next customer), Items sales (the cursor moves to the next party).
 * Pure rules live in `@shared/nav/*`; this file only reads the stores and runs the result. UI state only: never touches a bill's content, totals or the schema.
 * Phase 92 rule: nothing here returns a fresh array/object from a store selector (plain reads inside functions).
 */
import { ROUTES, currentPath } from '@shared/routes'
import { stepBill, withCurrentBill } from '@shared/nav/billStepping'
import { nextParty, type StepDir } from '@shared/nav/partyPaging'
import { distinctInOrder, firstRowOfParty, historyPartyFocus, pagingMode, type PagingMode } from '@shared/nav/pagingKeys'
import { partyOfRow, tabOf } from '@shared/items/salesView'
import { useRouter } from '../router/routerStore'
import { usePageMemoryStore, savePartyPageNow, restorePartyPage, cancelPageSave } from './pageMemoryStore'
import { useBillStore } from './billStore'
import { useHistoryStore } from './historyStore'
import { useCustomersStore } from './customersStore'
import { useItemsStore } from './itemsStore'
import { useSaveUiStore } from './saveUiStore'
import { requestLeave } from './guardStore'
import { openBillInPlace } from './createSession'

/** How many unreadable (deleted / trashed) bills one key press may skip before it gives up. */
export const STEP_SKIP_MAX = 25

let lastNote = { text: '', at: 0 }
/** The quiet end marker. The same text is not repeated within 2 s (a held key must not stack messages). */
function note(text: string): void {
  const now = Date.now()
  if (lastNote.text === text && now - lastNote.at < 2000) return
  lastNote = { text, at: now }
  useSaveUiStore.getState().announce('ok', text)
}
/** Test helper. */
export function resetPagingForTests(): void { lastNote = { text: '', at: 0 }; stepping = false }

/** A BillContext exists AND the bill on screen is the one it points at (a new bill, a draft or a stale context never steps). */
export function billSteppingActive(): boolean {
  if (currentPath(useRouter.getState().nav) !== ROUTES.create) return false
  const ctx = usePageMemoryStore.getState().billContext
  return !!ctx && ctx.orderedBillIds.length > 0 && useBillStore.getState().billId === ctx.currentId
}

/** Which meaning PageUp / PageDown have right now (see `pagingMode`). */
export function currentPagingMode(): PagingMode {
  const path = currentPath(useRouter.getState().nav)
  const hs = path === ROUTES.history ? useHistoryStore.getState() : null
  return pagingMode({
    path,
    billStepping: billSteppingActive(),
    historyPartyInFocus: hs !== null && historyPartyFocus(hs.query, useCustomersStore.getState().all) !== null,
    itemsSalesWindow: path === ROUTES.items && useItemsStore.getState().window === 'sales'
  })
}

let stepping = false

/** PageDown / PageUp in a bill opened from a list. Asks Save / Discard / Cancel first when the open bill has unsaved changes. */
export function stepOpenedBill(dir: StepDir): void {
  if (stepping || !billSteppingActive()) return
  const ctx0 = usePageMemoryStore.getState().billContext
  if (!ctx0) return
  if (stepBill(ctx0.orderedBillIds, ctx0.currentId, dir).atEnd) { note(dir === 'next' ? 'Last bill in this list' : 'First bill in this list'); return }
  // Clean bill: `go` runs now. Unsaved changes: the Save / Discard / Cancel dialog opens and `go` runs only after Save or Discard.
  requestLeave(() => { void go(dir) })
}

async function go(dir: StepDir): Promise<void> {
  if (stepping) return
  stepping = true
  try {
    const missing = new Set<string>()
    for (let tries = 0; tries <= STEP_SKIP_MAX; tries++) {
      const ctx = usePageMemoryStore.getState().billContext
      if (!ctx) return
      const r = stepBill(ctx.orderedBillIds, ctx.currentId, dir, { missing })
      if (r.id === null || r.atEnd) { note(dir === 'next' ? 'Last bill in this list' : 'First bill in this list'); return }
      const res = await openBillInPlace(r.id)
      if (res === 'ok') {
        const cur = usePageMemoryStore.getState().billContext
        if (cur) usePageMemoryStore.getState().setBillContext(withCurrentBill(cur, r.id))
        // The new bill opens at its top / first cell like any bill opened from a list.
        queueMicrotask(() => document.querySelector<HTMLElement>('.q3-create [role=grid]')?.focus())
        return
      }
      if (res === 'error') { useSaveUiStore.getState().announce('danger', 'Could not open the next bill'); return }
      missing.add(r.id) // deleted / trashed / synced away: skip it
    }
    useSaveUiStore.getState().announce('warn', 'Could not open the next bill')
  } finally {
    stepping = false
  }
}

/** PageDown / PageUp on a party screen. Returns true when it acted (or showed the end marker). */
export function stepParty(dir: StepDir): boolean {
  const path = currentPath(useRouter.getState().nav)
  if (path === ROUTES.customers) return stepCustomer(dir)
  if (path === ROUTES.items) return stepItemsParty(dir)
  if (path === ROUTES.history) return stepHistoryParty(dir)
  return false
}

function stepCustomer(dir: StepDir): boolean {
  const s = useCustomersStore.getState()
  if (s.edit !== null || s.rows.length === 0) return false
  // A customer's bills page is "a party's bills view": the next / previous customer's bills open in its place (a customer with no bills is skipped).
  const inBills = s.view === 'bills' && s.billsOf !== null
  const order = inBills ? s.rows.filter((x) => x.billCount > 0 || x.id === s.billsOf?.id) : s.rows
  const cur = inBills ? s.billsOf!.id : s.selectedId
  const r = nextParty(order.map((x) => x.id), cur, dir)
  if (r.id === null) return false
  if (r.atEnd && r.id === cur) { note(dir === 'next' ? 'Last customer in this list' : 'First customer in this list'); return true }
  s.select(r.id)
  if (inBills) void s.openBills()
  return true
}

function stepItemsParty(dir: StepDir): boolean {
  const s = useItemsStore.getState()
  if (!s.sales) return false
  const rows = tabOf(s.sales, s.salesTab).rows
  const keys = rows.map((x) => x.partyKey)
  const parties = distinctInOrder(keys)
  if (parties.length === 0) return false
  const r = nextParty(parties, partyOfRow(rows, s.salesCursor), dir)
  if (r.id === null) return false
  if (r.atEnd && r.id === partyOfRow(rows, s.salesCursor)) { note(dir === 'next' ? 'Last party in this list' : 'First party in this list'); return true }
  const at = firstRowOfParty(keys, r.id)
  if (at >= 0) s.setSalesCursor(at)
  return true
}

let historyToken = 0
function stepHistoryParty(dir: StepDir): boolean {
  const h = useHistoryStore.getState()
  const all = useCustomersStore.getState().all
  const cur = historyPartyFocus(h.query, all)
  if (cur === null) return false
  // Customers order (A to Z, as the Customers page lists them); a customer with no bills would only show an empty list, so it is skipped.
  const order = all.filter((c) => c.billCount > 0)
  const r = nextParty(order.map((c) => c.id), cur, dir)
  if (r.id === null) return false
  if (r.atEnd && r.id === cur) { note(dir === 'next' ? 'Last party in this list' : 'First party in this list'); return true }
  const target = order.find((c) => c.id === r.id)
  if (!target) return false
  const my = ++historyToken
  cancelPageSave(ROUTES.history)
  savePartyPageNow(ROUTES.history, cur) // where this party was left
  void h.setQuery(target.name).then(() => { if (my === historyToken) return restorePartyPage(ROUTES.history, target.id) }) // each party opens where it was left
  return true
}
