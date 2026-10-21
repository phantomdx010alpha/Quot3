import type { ReactElement } from 'react'
import type { Runs } from '../../shared/types'

/** An item name with its bold / red / highlight runs (read-only). Colours come from tokens via classes. */
export function RichName(props: { runs: Runs }): ReactElement {
  return (
    <>
      {props.runs.map((r, i) => (
        <span key={i} className={`${r.b ? 'q3-run-b ' : ''}${r.r ? 'q3-run-r ' : ''}${r.hl ? 'q3-run-hl' : ''}`.trim() || undefined}>{r.t}</span>
      ))}
    </>
  )
}
