import type { ReactElement } from 'react'
import { moneyText } from './display'

export interface TotalsRow {
  label: string
  /** A decimal string; shown in Indian grouping. */
  amount: string
}

/** The totals under a bill (Phase 190): the given rows in order (for a GST bill "Before GST", "GST", then adjustments / round-off), then the grand
 *  total, the largest figure, with the rupee sign. The rows come from the same footer lines the calc already produces; this only draws them. */
export function TotalsBlock(props: { rows: readonly TotalsRow[]; total: string; totalLabel?: string }): ReactElement {
  return (
    <dl className="q3x-totals" aria-label="Totals">
      {props.rows.map((r, i) => (
        <div className="q3x-totals-row" key={`${i}-${r.label}`}>
          <dt>{r.label}</dt>
          <dd className="q3x-amount">{moneyText(r.amount)}</dd>
        </div>
      ))}
      <div className="q3x-totals-grand">
        <dt>{props.totalLabel ?? 'Total'}</dt>
        <dd className="q3x-amount-grand">{moneyText(props.total, { symbol: true })}</dd>
      </div>
    </dl>
  )
}
