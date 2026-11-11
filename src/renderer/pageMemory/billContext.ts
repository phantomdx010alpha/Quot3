/**
 * Phase 219 (M21-4b): capture the `BillContext` (the FULL ordered, filtered list of bill IDs the owner was looking at) when a bill is
 * opened from History, a customer's bills or an item's sales. IDs only. Phase 220 uses it for PageUp / PageDown stepping.
 */
import type { Quot3Bridge } from '@shared/ipc'
import { ROUTES } from '@shared/routes'
import { makeBillContext } from '@shared/nav/billStepping'
import { sortBillsByInvoiceNumber } from '@shared/history/historyList'
import { tabOf } from '@shared/items/salesView'
import { usePageMemoryStore } from '../stores/pageMemoryStore'
import { listArgs, useHistoryStore } from '../stores/historyStore'
import { useTrashStore } from '../stores/trashStore'
import { useCustomersStore } from '../stores/customersStore'
import { useItemsStore } from '../stores/itemsStore'

/** Safety cap on the captured list (IDs only, so this is memory-cheap). */
export const BILL_CONTEXT_MAX = 20000

const hist = (): Quot3Bridge['history'] | undefined => (window as unknown as { quot3?: { history?: Quot3Bridge['history'] } }).quot3?.history
let token = 0

/** History: the search results (already every date), else dates newest first with each date's bills in invoice order, flattened. */
export function captureHistoryContext(currentId: string): void {
  const my = ++token
  const s = useHistoryStore.getState()
  if (useTrashStore.getState().open) { usePageMemoryStore.getState().setBillContext(null); return } // the trash view is not stepped through [A]
  const ids = s.bills.map((b) => b.id)
  usePageMemoryStore.getState().setBillContext(makeBillContext(ROUTES.history, ids, currentId))
  if (s.query.trim() !== '') return
  void expandHistory(my, currentId)
}

async function expandHistory(my: number, currentId: string): Promise<void> {
  const h = hist()
  if (!h) return
  const s0 = useHistoryStore.getState()
  const out: string[] = []
  try {
    for (const d of s0.dates) {
      if (my !== token) return
      let items = d.date === s0.date && s0.next === null ? s0.bills : null
      if (items === null) {
        items = []
        let cursor: string | undefined
        for (;;) {
          const r = await h.listBills({ date: d.date, ...(cursor ? { cursor } : {}), ...listArgs(s0) })
          if (my !== token) return
          if (!r.ok) return
          items = items.concat(r.data.items)
          if (!r.data.next) break
          cursor = r.data.next
        }
        items = sortBillsByInvoiceNumber(items)
      }
      for (const b of items) { out.push(b.id); if (out.length >= BILL_CONTEXT_MAX) break }
      if (out.length >= BILL_CONTEXT_MAX) break
    }
  } catch { return }
  const cur = usePageMemoryStore.getState().billContext
  if (my === token && cur && cur.sourcePath === ROUTES.history && out.includes(currentId)) usePageMemoryStore.getState().setBillContext(makeBillContext(ROUTES.history, out, cur.currentId))
}

export function captureCustomerContext(currentId: string): void {
  token++
  usePageMemoryStore.getState().setBillContext(makeBillContext(ROUTES.customers, useCustomersStore.getState().bills.map((b) => b.id), currentId))
}

export function captureItemsContext(currentId: string): void {
  token++
  const s = useItemsStore.getState()
  const rows = s.sales ? tabOf(s.sales, s.salesTab).rows : []
  const seen = new Set<string>()
  const ids = rows.map((r) => r.billId).filter((id) => (seen.has(id) ? false : (seen.add(id), true)))
  usePageMemoryStore.getState().setBillContext(makeBillContext(ROUTES.items, ids, currentId))
}
