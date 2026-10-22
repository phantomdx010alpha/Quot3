import { useEffect, useState, type ReactElement, type ReactNode } from 'react'

/** Phase 195: a closed-by-default "Advanced" fold for technical fields. The children stay mounted while folded, so typed values are kept and
 *  the fields are still in the page. `forceOpen` opens it when a hidden field has an error, so an error is never out of sight. */
export function AdvancedFold(props: { children: ReactNode; label?: string; forceOpen?: boolean }): ReactElement {
  const [open, setOpen] = useState(false)
  useEffect(() => { if (props.forceOpen) setOpen(true) }, [props.forceOpen])
  return (
    <details className="q3x-advanced" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="q3x-advanced-summary">{props.label ?? 'Advanced'}</summary>
      <div className="q3x-advanced-body">{props.children}</div>
    </details>
  )
}
