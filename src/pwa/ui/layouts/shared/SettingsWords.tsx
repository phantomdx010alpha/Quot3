import { plainText } from '../../kit/plainWords'

/** Phase 195: the Settings wording for the NEW phone layouts (design section 7). Classic passes nothing and keeps today's words.
 *  Pure helpers over the Phase 190 plain-word map; no format names, no data. */

export interface SettingsWords {
  /** Today's screen string -> the string this layout shows. */
  t: (today: string) => string
  /** True for the new layouts (they also fold the technical sign-in fields under "Advanced"). */
  plain: boolean
}

export const CLASSIC_WORDS: SettingsWords = { t: (s) => s, plain: false }
export const PLAIN_WORDS: SettingsWords = { t: plainText, plain: true }
export const settingsWords = (plain: boolean | undefined): SettingsWords => (plain ? PLAIN_WORDS : CLASSIC_WORDS)

/** Settings home hints that name a renamed thing; only the new layouts use these (the map in `plainWords.ts` stays at four entries). */
const PLAIN_HINTS: Readonly<Record<string, string>> = {
  'Sign in, PO prefix, share bills with your computers': 'Sign in and share bills with your computers'
}
export const plainHint = (words: SettingsWords, hint: string): string => (words.plain ? PLAIN_HINTS[hint] ?? hint : hint)
