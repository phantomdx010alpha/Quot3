import { ROUTES } from '@shared/routes'
import { useRouter } from '../router/routerStore'
import { openBillForEdit } from './createSession'
import { requestLeave } from './guardStore'
import { useSaveUiStore } from './saveUiStore'
import { useDashboardStore } from './dashboardStore'

/** Enter on a recent bill: open it on Create (asks first when the bill open there has unsaved changes). */
export function openRecentBill(id: string): boolean {
  const b = useDashboardStore.getState().stats?.recent.find((x) => x.id === id)
  if (!b) return false
  requestLeave(() => {
    void openBillForEdit(b.id).then((ok) => { if (!ok) useSaveUiStore.getState().announce('danger', `Could not open ${b.poNumber}`) })
  })
  return true
}

/** Enter on a top customer: the Customers page (where its bills are one key away). */
export function openTopCustomer(): void {
  useRouter.getState().navigate(ROUTES.customers)
}
