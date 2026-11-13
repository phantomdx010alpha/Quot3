import { useEffect, useState } from 'react'
import { Button, Dialog, Input } from '../ui'

export interface NamePromptProps {
  open: boolean
  title: string
  label: string
  initial?: string
  confirmLabel?: string
  /** Returns an error text to keep the dialog open, or null when done. */
  onSubmit: (name: string) => Promise<string | null> | string | null
  onCancel: () => void
}

/** Phase 238 - a small "type a name" dialog used for categories, tabs, columns and tiers (Enter = OK, Esc = cancel). */
export function NamePrompt({ open, title, label, initial = '', confirmLabel = 'OK', onSubmit, onCancel }: NamePromptProps): React.JSX.Element | null {
  const [text, setText] = useState(initial)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setText(initial); setError(''); setBusy(false) } }, [open, initial])
  const submit = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    const err = await onSubmit(text)
    setBusy(false)
    if (err) setError(err)
  }
  return (
    <Dialog open={open} title={title} onClose={onCancel} footer={<><Button onClick={onCancel}>Cancel</Button><Button variant="primary" disabled={busy || text.trim() === ''} onClick={() => { void submit() }}>{confirmLabel}</Button></>}>
      <Input label={label} value={text} error={error} data-autofocus autoComplete="off" onChange={(e) => { setText(e.target.value); setError('') }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }} />
    </Dialog>
  )
}
