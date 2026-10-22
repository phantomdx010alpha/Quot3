import { useEffect, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { X } from '@phosphor-icons/react'
import { Button } from './Button'
import { registerSheet } from './sheetStack'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** Modal bottom sheet (Phase 191). Focus moves into the dialog and returns to the opener on close; Tab stays inside; Esc, the Close button and a tap
 *  on the backdrop call `onClose`; while open it is in `sheetStack`, so Back closes it before the screen. Renders nothing when closed. */
export function BottomSheet(props: { open: boolean; title: string; onClose: () => void; children?: ReactNode }): ReactElement | null {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(props.onClose)
  closeRef.current = props.onClose
  const { open } = props

  useEffect(() => {
    if (!open) return undefined
    const opener = typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)
    const off = registerSheet(() => closeRef.current())
    ref.current?.focus()
    return () => {
      off()
      try { opener?.focus?.() } catch { /* the opener may be gone */ }
    }
  }, [open])

  if (!open) return null

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return }
    if (e.key !== 'Tab') return
    const node = ref.current
    if (!node) return
    const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled'))
    if (items.length === 0) { e.preventDefault(); node.focus(); return }
    const first = items[0]!
    const last = items[items.length - 1]!
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === node)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
  }

  return (
    <div className="q3x-sheet-root">
      <div className="q3x-sheet-backdrop" aria-hidden="true" onClick={() => closeRef.current()} />
      <div ref={ref} className="q3x-sheet" role="dialog" aria-modal="true" aria-label={props.title} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="q3x-sheet-handle" aria-hidden="true" />
        <div className="q3x-sheet-head">
          <h2 className="q3x-sheet-title">{props.title}</h2>
          <Button label="Close" hideLabel variant="text" icon={<X size={22} weight="bold" />} onClick={() => closeRef.current()} />
        </div>
        <div className="q3x-sheet-body">{props.children}</div>
      </div>
    </div>
  )
}
