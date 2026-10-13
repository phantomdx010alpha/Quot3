import { BUILTIN_THEME_IDS, CLAMPS, isTokenName } from './tokens'

export interface ThemeFile {
  id: string
  name: string
  /** Built-in theme this one inherits from (custom themes only). */
  base?: string
  /** Only whitelisted, sanitised overrides. Empty for built-ins (defined in tokens.css). */
  tokens: Record<string, string>
  builtin: boolean
}

export type ThemeValidation =
  | { ok: true; theme: ThemeFile; warnings: string[] }
  | { ok: false; errors: string[] }

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const NAME_MAX = 60
export const TOKEN_VALUE_MAX = 200
const MAX_TOKENS = 200

/** Characters a token value may contain. No `;`, braces, `<>`, `\`, `@`, `!`, `:`. */
const SAFE_VALUE_RE = /^[#a-zA-Z0-9\s.,%()\-+/*'"_]*$/
const DANGEROUS_RE = /url\s*\(|expression|javascript|import|\/\*|\*\/|image-set|element\s*\(|attr\s*\(/i

/** Returns null if the value is acceptable, otherwise the reason. */
export function checkTokenValue(value: string): string | null {
  if (value.length === 0) return 'empty value'
  if (value.length > TOKEN_VALUE_MAX) return `longer than ${TOKEN_VALUE_MAX} characters`
  if (DANGEROUS_RE.test(value)) return 'contains a forbidden construct (url(), expression, import …)'
  if (!SAFE_VALUE_RE.test(value)) return 'contains forbidden characters'
  // balanced parentheses
  let depth = 0
  for (const ch of value) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (depth < 0) return 'unbalanced parentheses'
  }
  return depth === 0 ? null : 'unbalanced parentheses'
}

/** Clamp a numeric token; returns [value, note?] or null when the value is not a plain number. */
function clampToken(name: string, value: string): { value: string; note?: string } | null | undefined {
  const rule = CLAMPS[name]
  if (!rule) return undefined // not a clamped token
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(px|ms)?\s*$/.exec(value)
  if (!m) return null
  if (m[2] && m[2] !== rule.unit) return null
  const n = Number(m[1])
  const clamped = Math.min(rule.max, Math.max(rule.min, n))
  const out = `${clamped}${rule.unit}`
  return clamped === n ? { value: out } : { value: out, note: `${name} clamped from ${value.trim()} to ${out}` }
}

/**
 * Validate an untrusted theme JSON value. A file with a hostile value (url(), expression …) or a bad
 * envelope is rejected as a whole; unknown token names are ignored (warning); numeric tokens are
 * clamped (warning). A theme can never execute anything.
 */
export function validateTheme(raw: unknown): ThemeValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['theme must be a JSON object'] }
  }
  const obj = raw as Record<string, unknown>
  const errors: string[] = []
  const warnings: string[] = []

  const id = obj['id']
  if (typeof id !== 'string' || !ID_RE.test(id)) errors.push('"id" must be 1–40 chars: a-z, 0-9, "-"')
  else if (BUILTIN_THEME_IDS.includes(id)) errors.push(`"id" "${id}" is reserved for a built-in theme`)

  const name = obj['name']
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > NAME_MAX) {
    errors.push(`"name" must be a non-empty string up to ${NAME_MAX} chars`)
  }

  const base = obj['base']
  if (base !== undefined && (typeof base !== 'string' || !BUILTIN_THEME_IDS.includes(base))) {
    errors.push(`"base" must be one of: ${BUILTIN_THEME_IDS.join(', ')}`)
  }

  const tokensRaw = obj['tokens']
  const tokens: Record<string, string> = {}
  if (tokensRaw !== undefined) {
    if (typeof tokensRaw !== 'object' || tokensRaw === null || Array.isArray(tokensRaw)) {
      errors.push('"tokens" must be an object')
    } else {
      const entries = Object.entries(tokensRaw as Record<string, unknown>)
      if (entries.length > MAX_TOKENS) errors.push(`too many tokens (max ${MAX_TOKENS})`)
      else {
        for (const [tokenName, tokenValue] of entries) {
          if (!isTokenName(tokenName)) {
            warnings.push(`unknown token ${JSON.stringify(tokenName).slice(0, 60)} ignored`)
            continue
          }
          if (typeof tokenValue !== 'string') {
            errors.push(`${tokenName}: value must be a string`)
            continue
          }
          const bad = checkTokenValue(tokenValue)
          if (bad) {
            errors.push(`${tokenName}: ${bad}`)
            continue
          }
          const clamped = clampToken(tokenName, tokenValue)
          if (clamped === null) {
            errors.push(`${tokenName}: must be a plain number in ${CLAMPS[tokenName]?.unit ?? 'px'}`)
            continue
          }
          if (clamped) {
            tokens[tokenName] = clamped.value
            if (clamped.note) warnings.push(clamped.note)
          } else {
            tokens[tokenName] = tokenValue.trim()
          }
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  const theme: ThemeFile = {
    id: id as string,
    name: (name as string).trim(),
    tokens,
    builtin: false,
    ...(typeof base === 'string' ? { base } : {})
  }
  return { ok: true, theme, warnings }
}
