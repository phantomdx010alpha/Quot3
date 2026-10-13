import { cloneElement, useId, useRef, useState, type ReactElement } from 'react'
import { Kbd } from './Kbd'

export interface TooltipProps {
  label: string
  /** Optional shortcut shown beside the label, e.g. "Ctrl+S". */
  shortcut?: string
  children: ReactElement<Record<string, unknown>>
}

const SHOW_DELAY_MS = 350

/** Shows on hover (after a short delay) and on keyboard focus; hides on blur/Esc/leave. */
export function Tooltip({ label, shortcut, children }: TooltipProps): React.JSX.Element {
  const id = useId()
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const show = (immediate: boolean): void => {
    clearTimeout(timer.current)
    if (immediate) setOpen(true)
    else timer.current = setTimeout(() => setOpen(true), SHOW_DELAY_MS)
  }
  const hide = (): void => {
    clearTimeout(timer.current)
    setOpen(false)
  }
  const child = cloneElement(children, { 'aria-describedby': open ? id : undefined })
  return (
    <span
      className="q3-tip-wrap"
      onMouseEnter={() => show(false)}
      onMouseLeave={hide}
      onFocus={() => show(true)}
      onBlur={hide}
      onKeyDown={(e) => e.key === 'Escape' && hide()}
    >
      {child}
      {open && (
        <span id={id} role="tooltip" className="q3-tip">
          {label}
          {shortcut && <Kbd keys={shortcut} />}
        </span>
      )}
    </span>
  )
}
