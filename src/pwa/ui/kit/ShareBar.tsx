import type { ReactElement } from 'react'
import { SegmentedControl } from './SegmentedControl'
import { Button } from './Button'
import { ACTION_OFF_WORDS } from '../../../shared/seatRights'
import { useSeatRights } from '../useSeatRights'
import { useShare, type UseShareOptions } from './useShare'

export interface ShareBarProps extends UseShareOptions {
  /** `view` = Share (+ Edit / Done); `review` also shows the Rough / Professional and Image / PDF choices. */
  mode?: 'view' | 'review'
  onEdit?: () => void
  /** Phase 192: "Edit on PC" text and a disabled Edit for bills the phone cannot edit. */
  editLabel?: string
  editDisabled?: boolean
  onDone?: () => void
  /** Phase 284: shows a "Share QR" button (view mode) that opens the bill's payment QR sheet. */
  onShareQr?: () => void
}

/** [Share (primary)] [Edit] [Done] over the existing share code (Phase 191). It never changes the bill. No print, no clipboard image. */
export function ShareBar(props: ShareBarProps): ReactElement {
  const s = useShare(props)
  const rights = useSeatRights()
  const canShare = rights.can('shareBills')
  const review = props.mode === 'review'
  return (
    <section className="q3x-sharebar" aria-label="Share">
      {review && canShare ? (
        <>
          <SegmentedControl ariaLabel="Style" value={s.style} onChange={(v) => s.pickStyle(v as 'rough' | 'professional')} options={[{ id: 'rough', label: 'Rough' }, { id: 'professional', label: 'Professional' }]} />
          <SegmentedControl ariaLabel="Format" value={s.kind} onChange={(v) => s.pickKind(v as 'image' | 'pdf')} options={[{ id: 'image', label: 'Image' }, { id: 'pdf', label: 'PDF' }]} />
          {s.noCompany ? <p className="q3x-sharebar-text" role="note">No company name yet: the page shows a placeholder. Add yours in Settings.</p> : null}
        </>
      ) : null}
      <div className="q3x-sharebar-row">
        {canShare ? <Button label={s.busy ? 'Preparing' : 'Share'} variant="primary" disabled={s.busy} onClick={() => { void s.go() }} /> : null}
        {canShare && props.onShareQr && !review ? <Button label="Share QR" variant="secondary" disabled={s.busy} onClick={props.onShareQr} /> : null}
        {props.onEdit ? <Button label={props.editLabel ?? 'Edit'} variant="secondary" disabled={props.editDisabled} onClick={props.onEdit} /> : null}
        {props.onDone ? <Button label="Done" variant="secondary" onClick={props.onDone} /> : null}
      </div>
      {!canShare ? <p className="q3x-sharebar-text" role="note">{ACTION_OFF_WORDS.shareBills}</p> : null}
      {s.note ? <p className="q3x-sharebar-text" role="status">{s.note}</p> : null}
      {s.error ? <p className="q3x-sharebar-text q3x-sharebar-warn" role="alert">{s.error}</p> : null}
    </section>
  )
}
