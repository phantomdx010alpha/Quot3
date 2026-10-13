import { describeUpdate } from '@shared/updater'
import { Button } from '../ui'
import { restartToUpdate, useUpdateStore } from '../../stores/updateStore'
import { useBillStore } from '../../stores/billStore'

/**
 * Phase 62 - a thin bar shown only when an update has been downloaded. While an unsaved bill is open it only says the update
 * will wait; the Restart button then goes through the Save / Discard / Cancel guard. It never restarts by itself.
 */
export function UpdateBanner(): React.JSX.Element | null {
  const state = useUpdateStore((s) => s.state)
  const dirty = useBillStore((s) => s.billId !== null && s.dirty)
  if (state.phase !== 'ready') return null
  const copy = describeUpdate({ ...state, busy: dirty })
  return (
    <div className="q3-upb" role="status" data-testid="update-banner">
      <span className="q3-upb__text"><strong>{copy.title}.</strong> {copy.detail}</span>
      <Button size="sm" variant="primary" onClick={() => restartToUpdate()}>{state.mode === 'rollback' ? 'Restart to go back' : 'Restart to update'}</Button>
    </div>
  )
}
