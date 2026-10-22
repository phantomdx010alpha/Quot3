import { useId, type ReactElement } from 'react'
import { isIsoDate } from './dateField'

/** Labelled native date input (Phase 191, new layouts only [A]). Calls `onChange` only with a real `YYYY-MM-DD` date. */
export function DateField(props: { label: string; value: string; onChange: (iso: string) => void }): ReactElement {
  const id = useId()
  return (
    <div className="q3x-date">
      <label className="q3x-date-label" htmlFor={id}>{props.label}</label>
      <input id={id} type="date" className="q3x-date-input" value={props.value} onChange={(e) => { if (isIsoDate(e.target.value)) props.onChange(e.target.value) }} />
    </div>
  )
}
