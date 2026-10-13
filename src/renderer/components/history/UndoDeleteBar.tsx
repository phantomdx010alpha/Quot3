import { ArrowCounterClockwise } from '@phosphor-icons/react'
import { Button } from '../ui'
import type { UndoOffer } from '../../stores/trashStore'

/** Phase 43: shown for ~10 s after a delete. The offer lives in `trashStore`; Ctrl+Z on History does the same as the button. */
export function UndoDeleteBar({ offer, onUndo }: { offer: UndoOffer; onUndo: () => void }): React.JSX.Element {
  return (
    <div className="q3-hist__undo" role="status" aria-live="polite">
      <span>Deleted {offer.label}.</span>
      <Button size="sm" icon={ArrowCounterClockwise} shortcut="Ctrl+Z" onMouseDown={(e) => e.preventDefault()} onClick={onUndo}>Undo delete</Button>
    </div>
  )
}
