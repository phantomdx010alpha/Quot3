import { BUILTIN_THEME_IDS, DEFAULT_THEME_ID, TOKEN_NAMES } from './tokens'
import { checkTokenValue, validateTheme, type ThemeFile } from './validateTheme'

/**
 * Phase 49 - "Export current theme as a starter file" (pure). The renderer reads the computed value of every whitelisted
 * token from the live page and hands them here; the result is a theme file that passes `validateTheme` and, when loaded,
 * looks exactly like the theme it was made from.
 */
export interface StarterInput {
  /** The theme being exported (built-in or custom). */
  fromId: string
  fromName: string
  /** Built-in the exported theme sits on (custom themes) - a built-in uses its own id. */
  fromBase?: string
  builtin: boolean
  /** Computed value per token name, as read from the page. Anything not on the whitelist or not safe is dropped. */
  computed: Record<string, string>
  /** Ids already taken (built-ins + files in the folder); the new id is made unique against them. */
  takenIds: readonly string[]
}

export interface StarterTheme {
  id: string
  name: string
  base: string
  tokens: Record<string, string>
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** `<id>-copy`, then `-copy-2`, `-copy-3` ... always within the 40-character id limit and never a built-in id. */
export function uniqueThemeId(fromId: string, taken: readonly string[]): string {
  const used = new Set([...taken, ...BUILTIN_THEME_IDS])
  const stem = (slug(fromId) || 'theme').slice(0, 30).replace(/-+$/, '')
  let id = `${stem}-copy`
  for (let n = 2; used.has(id); n++) id = `${stem}-copy-${n}`
  return id
}

export function buildStarterTheme(input: StarterInput): StarterTheme {
  const base = input.builtin ? input.fromId : BUILTIN_THEME_IDS.includes(input.fromBase ?? '') ? (input.fromBase as string) : DEFAULT_THEME_ID
  const tokens: Record<string, string> = {}
  for (const name of TOKEN_NAMES) {
    const raw = input.computed[name]
    if (typeof raw !== 'string') continue
    const value = raw.trim().replace(/\s+/g, ' ')
    if (value === '' || checkTokenValue(value) !== null) continue
    tokens[name] = value
  }
  const name = `${input.fromName.trim() || input.fromId} copy`.slice(0, 60)
  return { id: uniqueThemeId(input.fromId, input.takenIds), name, base, tokens }
}

/** Serialised exactly as written to disk (2-space JSON, trailing newline). */
export function starterToJson(t: StarterTheme): string {
  return `${JSON.stringify(t, null, 2)}\n`
}

/** True when the starter survives the same validation a dropped-in file gets. */
export function starterIsValid(t: StarterTheme): ThemeFile | null {
  const v = validateTheme(t)
  return v.ok ? v.theme : null
}
