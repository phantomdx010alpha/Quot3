import type { ReactElement } from 'react'
import { ProfilePage } from '../../ProfilePage'
import { useSeatRights } from '../../useSeatRights'
import type { ScreenProps } from '../types'

/** Phase 295: the Profile route for the three new layouts (the page lives in `ui/ProfilePage.tsx`; the layouts only host it). */
export function ProfileScreen(props: ScreenProps): ReactElement {
  const rights = useSeatRights()
  return (
    <ProfilePage
      db={props.db} version={props.profile?.version ?? ''} engine={props.profile?.engine ?? null}
      onOpenCompany={() => props.onNavigate('settings', 'company')}
      onOpenPayments={rights.can('seePayments') ? () => props.onNavigate('payments') : undefined}
    />
  )
}
