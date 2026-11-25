/**
 * Phase 284 (M25) - "Share QR" on a bill: a sheet that hosts the Payments page with this bill's total already in the amount box (editable for a
 * part or advance payment; empty = payer enters). The result is its own QR image through `shareSheet`, never inside the bill image.
 */
import { useMemo, type ReactElement } from 'react'
import type { Bill } from '../../../shared/types'
import type { PhoneDb } from '../../data/db'
import { billQrInfo } from '../../share/billQr'
import type { PaymentsSync } from '../../sync/payments'
import { BottomSheet } from './BottomSheet'
import { PaymentsPage } from './PaymentsPage'
import { PAY_WORDS } from './paymentsModel'

export function BillQrSheet(props: { open: boolean; onClose: () => void; db: PhoneDb; bill: Bill; payments?: PaymentsSync }): ReactElement | null {
  const info = useMemo(() => billQrInfo(props.bill), [props.bill])
  return (
    <BottomSheet open={props.open} title={PAY_WORDS.shareQr} onClose={props.onClose}>
      <PaymentsPage db={props.db} payments={props.payments} bill={info} />
    </BottomSheet>
  )
}
