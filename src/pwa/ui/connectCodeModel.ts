import { masterErrorWords } from '../../shared/master/errors'
import { SEAT_CODE_LEN, seatCodeChars, validateSeatCode } from '../../shared/master/seatCode'

/**
 * Phase 269 - what the one-code screen says while the person types or pastes (pure, no network). The check character is verified offline by
 * `validateSeatCode`, so a typo is named before "Connect" is ever tapped.
 */
export interface CodeFeedback {
  state: 'empty' | 'typing' | 'ok' | 'bad'
  text: string
  /** The Connect button is enabled only for a code that passes the offline check. */
  canConnect: boolean
}

export function codeFeedback(input: string): CodeFeedback {
  const n = seatCodeChars(input).length
  if (n === 0) return { state: 'empty', text: '', canConnect: false }
  if (n < SEAT_CODE_LEN) return { state: 'typing', text: `${n} of ${SEAT_CODE_LEN} characters`, canConnect: false }
  if (n > SEAT_CODE_LEN) return { state: 'bad', text: 'That is longer than a code. Check it and try again.', canConnect: false }
  const v = validateSeatCode(input)
  if (v.ok) return { state: 'ok', text: 'The code looks right.', canConnect: true }
  return { state: 'bad', text: masterErrorWords('Q3M91'), canConnect: false }
}

export const CONNECT_SKIPPED_SETTING = 'connect.skipped'

/** Which gate the phone shows at start (pure). `skipped` is the person's earlier "Not now" [A]; `removed` is the "seat removed" flag. */
export type ConnectGate = 'none' | 'first' | 'removed'
export function connectGate(a: { ready: boolean; linked: boolean; skipped: boolean; removed: boolean }): ConnectGate {
  if (!a.ready) return 'none' // the master is not switched on in this build: exactly the old behaviour
  if (a.linked) return a.removed ? 'removed' : 'none'
  return a.skipped ? 'none' : 'first'
}
