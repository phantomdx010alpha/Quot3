import type { ReactElement } from 'react'

/** A row of exclusive choices (GST / Non-GST, Rough / Professional). The group has a name; each choice is a named button with `aria-pressed`. */
export function SegmentedControl<T extends string>(props: {
  ariaLabel: string
  options: readonly { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}): ReactElement {
  return (
    <div className="q3x-seg" role="group" aria-label={props.ariaLabel}>
      {props.options.map((o) => (
        <button key={o.id} type="button" className="q3x-seg-btn" aria-pressed={props.value === o.id} onClick={() => props.onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  )
}
