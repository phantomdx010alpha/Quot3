import type { ReactElement, ReactNode } from 'react'
import { itemDetail, moneyText } from './display'

/** One bill item, two lines (Phase 190): the name wraps fully (never an ellipsis) with the line total on the right, then a muted line such as
 *  "382 x Rs34 · +18% GST". `name` is a node so the rich-text name (bold / red runs, `RichName`) can be passed in. Display only. */
export function ItemLine(props: { name: ReactNode; amount: string; qty?: string; rate?: string; gstPct?: string; priceSetByUser?: boolean }): ReactElement {
  const detail = itemDetail(props)
  return (
    <div className="q3x-item">
      <div className="q3x-item-top">
        <span className="q3x-item-name">{props.name}</span>
        <span className="q3x-amount">{moneyText(props.amount)}</span>
      </div>
      {detail !== '' ? <div className="q3x-item-detail">{detail}</div> : null}
    </div>
  )
}
