import type { KeyboardEvent } from 'react'
import { choiceFromKey, guardCopy } from '@shared/dirtyGuard'
import { Button, Dialog } from '../ui'
import { chooseCancel, chooseDiscard, chooseSave, useGuardStore } from '../../stores/guardStore'

/** Phase 28 — Save / Discard / Cancel (keys S / D / Esc). Mounted once in the app shell; opened by `requestLeave`. */
export function UnsavedDialog(): React.JSX.Element | null {
  const open = useGuardStore((s) => s.open)
  const saved = useGuardStore((s) => s.saved)
  const busy = useGuardStore((s) => s.busy)
  const copy = guardCopy(saved)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.ctrlKey || e.altKey || e.metaKey) return
    const c = choiceFromKey(e.key)
    if (c === null || c === 'cancel') return // Esc is the Dialog's own onClose
    e.preventDefault()
    e.stopPropagation()
    if (c === 'save') void chooseSave()
    else chooseDiscard()
  }

  return (
    <Dialog
      open={open}
      title={copy.title}
      onClose={chooseCancel}
      footer={
        <>
          <Button onClick={chooseCancel} shortcut="Esc">Cancel</Button>
          <Button variant="danger" onClick={chooseDiscard} shortcut="D">Discard</Button>
          <Button variant="primary" onClick={() => { void chooseSave() }} disabled={busy} shortcut="S" data-autofocus>{copy.saveLabel}</Button>
        </>
      }
    >
      <div data-guard-keys onKeyDown={onKeyDown}>{copy.message}</div>
    </Dialog>
  )
}
