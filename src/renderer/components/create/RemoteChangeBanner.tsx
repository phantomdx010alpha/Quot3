import { GitBranch } from '@phosphor-icons/react'
import { Button, Icon } from '../ui'
import { useBillStore } from '../../stores/billStore'
import { heldForOpenBill, keepMine, loadTheirs, useRemoteChangeStore } from '../../stores/remoteChangeStore'

/**
 * Phase 56 - one line above the party bar when another branch changed the bill that is open here (UR 2.7). The open bill is
 * never changed behind the owner's back: Keep mine drops the other version, Load theirs replaces what is on screen with it.
 */
export function RemoteChangeBanner(): React.JSX.Element | null {
  const held = useRemoteChangeStore((s) => s.held)
  const billId = useBillStore((s) => s.billId)
  const h = heldForOpenBill(held, billId)
  if (!h) return null
  return (
    <div className="q3-remote" role="alert" data-testid="remote-change-banner">
      <Icon icon={GitBranch} weight="bold" size="md" />
      <span className="q3-remote__text">
        {h.deleted ? 'Deleted on another branch' : 'Changed on another branch'}{h.fromBranchName ? ` (${h.fromBranchName})` : ''}
      </span>
      <Button size="sm" variant="secondary" onClick={() => { void keepMine() }}>Keep mine</Button>
      <Button size="sm" variant="primary" onClick={() => { void loadTheirs() }}>Load theirs</Button>
    </div>
  )
}
