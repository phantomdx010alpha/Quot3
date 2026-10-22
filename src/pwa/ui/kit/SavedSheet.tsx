import type { ReactElement } from 'react'
import type { Bill } from '../../../shared/types'
import { BottomSheet } from './BottomSheet'
import { ShareBar, type ShareBarProps } from './ShareBar'

export interface SavedSheetProps extends Omit<ShareBarProps, 'bill' | 'mode' | 'onDone'> {
  open: boolean
  bill: Bill | null
  onDone: () => void
}

/** The "Saved" sheet (Phase 191): confirms the save, offers Share, then Done. Reads the saved bill only; never changes it. */
export function SavedSheet(props: SavedSheetProps): ReactElement | null {
  const { open, bill, onDone, ...share } = props
  if (!open || !bill) return null
  const party = bill.party.name.trim()
  return (
    <BottomSheet open title="Saved" onClose={onDone}>
      <p className="q3x-saved-text">{party ? `Bill ${bill.poNumber} for ${party} is saved.` : `Bill ${bill.poNumber} is saved.`}</p>
      <ShareBar {...share} bill={bill} mode="view" onDone={onDone} />
    </BottomSheet>
  )
}
