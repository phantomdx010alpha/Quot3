import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'

export interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Phase 44: a wide dialog (the revision panel). */
  wide?: boolean
  /** Extra class on the dialog box (Phase 127 hotfix: the print dialog sizes itself to its preview). */
  className?: string
}

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** Modal: Esc closes, Tab is trapped, focus returns to the opener. Focus goes to [data-autofocus] if present. */
export function Dialog({ open, title, onClose, children, footer, wide, className }: DialogProps): React.JSX.Element | null {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const root = ref.current
    const first = root?.querySelector<HTMLElement>('[data-autofocus]') ?? root?.querySelector<HTMLElement>(FOCUSABLE) ?? root
    first?.focus()
    return () => opener?.focus?.()
  }, [open])

  if (!open) return null

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !ref.current) return
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) return
    const firstEl = items[0]!
    const lastEl = items[items.length - 1]!
    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault()
      lastEl.focus()
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault()
      firstEl.focus()
    }
  }

  return createPortal(
    <div className="q3-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`${wide ? 'q3-dialog q3-dialog--wide nm-raised nm-lg' : 'q3-dialog nm-raised nm-lg'}${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <h2 id={titleId} className="q3-dialog__title">
          {title}
        </h2>
        <div className="q3-dialog__body">{children}</div>
        {footer && <div className="q3-dialog__footer">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Destructive confirms focus Cancel first (safe default); others focus the confirm button. */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, onConfirm, onCancel }: ConfirmDialogProps): React.JSX.Element | null {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel} {...(danger ? { 'data-autofocus': true } : {})}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} {...(!danger ? { 'data-autofocus': true } : {})}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message}
    </Dialog>
  )
}
