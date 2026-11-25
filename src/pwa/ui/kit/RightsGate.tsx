import { useEffect, type ComponentType, type ReactElement } from 'react'
import { NOT_AVAILABLE_WORDS, type SeatFlag } from '../../../shared/seatRights'
import type { ScreenProps } from '../layouts/types'
import { useSeatRights } from '../useSeatRights'

/** Phase 290 (M25-5): a route whose right is off shows "Not available" and goes back. Wraps a layout screen; the screen is not even mounted. */
function NotAvailable(props: { onBack?: () => void }): ReactElement {
  const { onBack } = props
  useEffect(() => { onBack?.() }, [onBack])
  return <p className="q3-muted" role="status">{NOT_AVAILABLE_WORDS}</p>
}

export function gatedScreen(Screen: ComponentType<ScreenProps>, flag: SeatFlag): ComponentType<ScreenProps> {
  function Gated(props: ScreenProps): ReactElement {
    const rights = useSeatRights()
    return rights.can(flag) ? <Screen {...props} /> : <NotAvailable onBack={props.onBack} />
  }
  Gated.displayName = `Gated(${flag})`
  return Gated
}
