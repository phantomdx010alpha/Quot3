import { useSyncExternalStore } from 'react'
import { canDo, SEAT_RIGHTS_SOURCE_WORDS, type SeatFlag } from '../../shared/seatRights'
import { getSeatRightsSnapshot, subscribeSeatRights, type SeatRightsSnapshot } from '../data/seatRights'

/** Phase 288 (M25-7): the hook every phone screen uses to ask for its rights. Re-renders when the runtime publishes a new answer. */
export function useSeatRights(): SeatRightsSnapshot & { can: (flag: SeatFlag) => boolean; words: string } {
  const s = useSyncExternalStore(subscribeSeatRights, getSeatRightsSnapshot, getSeatRightsSnapshot)
  return { ...s, can: (flag) => canDo(s.flags, flag), words: SEAT_RIGHTS_SOURCE_WORDS[s.source] }
}
