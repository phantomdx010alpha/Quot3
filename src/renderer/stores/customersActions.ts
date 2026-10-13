import { currentPath, ROUTES } from '@shared/routes'
import { useRouter } from '../router/routerStore'
import { openBillForEdit } from './createSession'
import { useCustomersStore } from './customersStore'
import { requestLeave } from './guardStore'
import { useSaveUiStore } from './saveUiStore'

/** Phase 45 - what the owner can do on the Customers page; results are announced on the shared status line. */
const say = (tone: 'ok' | 'warn' | 'danger', m: string): void => useSaveUiStore.getState().announce(tone, m)

export const onCustomersPage = (): boolean => currentPath(useRouter.getState().nav) === ROUTES.customers

/** Enter on a bill of the customer: open it in Create (asks first when the bill open there has unsaved changes). */
export function openCustomerBill(id: string): boolean {
  const b = useCustomersStore.getState().bills.find((x) => x.id === id)
  if (!b) return false
  requestLeave(() => {
    void openBillForEdit(b.id).then((ok) => { if (!ok) say('danger', `Could not open ${b.poNumber}`) })
  })
  return true
}

export async function saveCustomerEdit(): Promise<boolean> {
  const wasNew = useCustomersStore.getState().edit?.id === null
  const id = await useCustomersStore.getState().saveEdit()
  if (id === null) return false
  say('ok', wasNew ? 'Customer added' : 'Customer saved')
  useCustomersStore.getState().focusList?.()
  return true
}

export function cancelCustomerEdit(): void {
  useCustomersStore.getState().cancelEdit()
  useCustomersStore.getState().focusList?.()
}

export async function confirmCustomerDelete(): Promise<boolean> {
  const gone = await useCustomersStore.getState().confirmDeleteNow()
  useCustomersStore.getState().focusList?.()
  if (!gone) { say('danger', 'Nothing was deleted'); return false }
  say('ok', `Deleted ${gone.name} - its bills keep their details`)
  return true
}

export function cancelCustomerDelete(): void {
  useCustomersStore.getState().cancelDelete()
  useCustomersStore.getState().focusList?.()
}

/** Bills of the highlighted customer (Right / the button). */
export async function showCustomerBills(): Promise<boolean> {
  const s = useCustomersStore.getState()
  if (s.selected() === null) { say('warn', 'Select a customer first'); return false }
  const ok = await s.openBills()
  if (ok) queueMicrotask(() => useCustomersStore.getState().focusBills?.())
  return ok
}

export function backToCustomers(): void {
  useCustomersStore.getState().closeBills()
  queueMicrotask(() => useCustomersStore.getState().focusList?.())
}
