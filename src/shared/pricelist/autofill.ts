/**
 * Phase 235 (M23) - the billing auto-fill row state machine (pure). MILESTONE23_DESIGN 4.3. UI state only: never stored in the bill.
 * The caller runs `decideFill` only when the cursor LEAVES an item-name cell (never per keystroke, never while a saved bill loads,
 * never for a bill opened from History) and writes a fill through the normal grid edit command as ONE undo step.
 */
import { isNumericStr } from '../money'
import type { MatchResult } from './match'

export interface AutofillRowState {
  /** Any typing in the Rate cell sets this (even if later cleared): the row is never auto-filled again this session. */
  rateTouched: boolean
  autoFilledValue: string | null
  autoFilledForNameKey: string | null
}
export const freshRowState = (): AutofillRowState => ({ rateTouched: false, autoFilledValue: null, autoFilledForNameKey: null })

/** The owner typed in the Rate cell. */
export const onRateTyped = (s: AutofillRowState): AutofillRowState => (s.rateTouched ? s : { ...s, rateTouched: true })

export type FillMode = 'off' | 'suggest' | 'auto'
export type NoFillReason =
  | 'mode' | 'loading' | 'no_rate_column' | 'no_tier' | 'rate_touched' | 'rate_has_value' | 'no_name' | 'no_confident_match' | 'no_tier_value' | 'same_name' | 'same_value'

export interface FillInput {
  mode: FillMode
  /** True while a saved bill is being loaded / opened: nothing fills. */
  loading: boolean
  /** The bill's format has a rate column. */
  formatHasRate: boolean
  /** The tier mapped to the bill's format (setting), or null / undefined when none. */
  tierKey: string | null | undefined
  /** The row's current Rate cell text. */
  rateText: string
  /** `normaliseItem(name).key` of the item name now. */
  nameKey: string
  match: MatchResult
  /** The matched row's value for the tier column, or '' / undefined when it has none. */
  tierValue: string | undefined
}
export type FillDecision =
  | { action: 'fill'; value: string; state: AutofillRowState; replaced: boolean }
  | { action: 'none'; reason: NoFillReason; state: AutofillRowState }

const sameNumber = (a: string, b: string): boolean => a.trim() === b.trim()

export function decideFill(state: AutofillRowState, i: FillInput): FillDecision {
  const none = (reason: NoFillReason): FillDecision => ({ action: 'none', reason, state })
  if (i.mode !== 'auto') return none('mode')
  if (i.loading) return none('loading')
  if (!i.formatHasRate) return none('no_rate_column')
  if (!i.tierKey) return none('no_tier')
  if (state.rateTouched) return none('rate_touched')
  if (i.nameKey === '') return none('no_name')
  const rate = i.rateText.trim()
  const hasAuto = state.autoFilledValue !== null
  // a rate that is not exactly what we filled is the owner's (typed, pasted or loaded): never overwritten
  if (rate !== '' && !(hasAuto && sameNumber(rate, state.autoFilledValue!))) return none('rate_has_value')
  if (hasAuto && rate !== '' && state.autoFilledForNameKey === i.nameKey) return none('same_name')
  if (!i.match.confident || !i.match.best) return none('no_confident_match')
  const v = (i.tierValue ?? '').trim()
  if (v === '' || !isNumericStr(v)) return none('no_tier_value')
  if (rate !== '' && sameNumber(rate, v)) return { action: 'none', reason: 'same_value', state: { ...state, autoFilledForNameKey: i.nameKey } }
  return { action: 'fill', value: v, replaced: rate !== '', state: { rateTouched: false, autoFilledValue: v, autoFilledForNameKey: i.nameKey } }
}

/** After an undo removed the fill, forget it so a later leave may fill again. */
export const onFillUndone = (s: AutofillRowState): AutofillRowState => ({ ...s, autoFilledValue: null, autoFilledForNameKey: null })
