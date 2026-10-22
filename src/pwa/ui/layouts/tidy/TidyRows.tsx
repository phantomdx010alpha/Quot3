import type { ReactElement } from 'react'

/** A two-line bill row (Phase 192): the party name wraps fully, the amount sits right, the second line is the PO number and date. */
export function BillRow(props: { id: string; party: string; sub: string; total: string; onOpen: (id: string) => void }): ReactElement {
  return (
    <li className="q3x-tidy-li">
      <button type="button" className="q3x-tidy-row" onClick={() => props.onOpen(props.id)}>
        <span className="q3x-tidy-row-main">
          <span className="q3x-tidy-row-title">{props.party || 'No name'}</span>
          <span className="q3x-tidy-sub">{props.sub}</span>
        </span>
        <span className="q3x-amount">{props.total}</span>
      </button>
    </li>
  )
}
