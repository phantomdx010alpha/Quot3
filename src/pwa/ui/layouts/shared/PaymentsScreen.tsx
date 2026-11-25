import type { ReactElement } from 'react'
import { PaymentsPage } from '../../kit/PaymentsPage'
import type { ScreenProps } from '../types'

/** Phase 283: the Payments route for the three new layouts (the page itself lives in the kit, so the layouts only host it). */
export function PaymentsScreen(props: ScreenProps): ReactElement {
  return <PaymentsPage db={props.db} payments={props.payments} onChanged={props.onChanged} />
}
