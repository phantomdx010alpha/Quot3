/**
 * Phase 107 - item-name normaliser (ITEM_SORTER_SPEC section 2, steps 1-4). Pure: no Electron, no Node, no DOM, no I/O.
 *
 *   1. clean   : uppercase, unify separators, `32 x 50` / `32*50` -> `32X50`, bracket notes split off into `note`
 *   2. filter  : charge / less / advance / GST / coolie lines are NOT items (rule list below is data, owner-editable later)
 *   3. key     : the sorted tokens of the cleaned name, so "TALCO 2044" and "2044 TALCO" share one key
 *   4. protect : any token with a digit, a size, a fraction or a unit must match exactly; it is never fuzzy-changed
 *
 * Nothing here learns, guesses or merges spellings: that is Phase 108. Deterministic and explainable: a filtered line reports the
 * rule that matched.
 */

export interface NonProductRule {
  /** Stable id shown to the owner as the "why". */
  id: string
  label: string
  /** Tested against the CLEANED name (uppercase, separators collapsed to single spaces). */
  pattern: RegExp
}

/**
 * Lines that are charges, deductions or payments, not goods. Data, not code paths: add a rule here, nothing else changes.
 * Patterns run on the cleaned name, where `+ - _ . , ; : ( )` are already single spaces.
 */
export const NON_PRODUCT_RULES: readonly NonProductRule[] = [
  { id: 'gst-line', label: 'GST line', pattern: /^GST\b|\bGST EXTRA\b|\bAND GST\b|\bGST\b.*\d+\s*%|\bPLUS GST\b|\bEXTRA GST\b/ },
  { id: 'coolie', label: 'Coolie / loading', pattern: /\bCOOLIE\b|\bCOOLY\b|\bHAMALI\b/ },
  { id: 'less', label: 'Less / deduction', pattern: /^LESS\b|^DISCOUNT\b|^REBATE\b|^DEDUCTION\b/ },
  { id: 'advance', label: 'Advance / payment', pattern: /^ADVANCE(?: (?:PAYMENT|AMOUNT|RECEIVED|PAID|GIVEN))?$|^(?:PAYMENT|PAID|RECEIVED|CASH RECEIVED|PART PAYMENT)$/ },
  { id: 'charge', label: 'Charge', pattern: /\bCHARGES?\b/ },
  { id: 'freight', label: 'Freight / courier / packing', pattern: /^(?:FREIGHT|COURIER|PACKING|PACKAGING|TRANSPORT|CARTAGE|FORWARDING|POSTAGE|DELIVERY)(?: AND [A-Z]+)?$/ },
  { id: 'round-off', label: 'Round off', pattern: /^ROUND ?OFF$|^ROUNDING$/ }
]

/** Unit words that must stay exact (spec section 2 step 4). Compared after cleaning, so already uppercase. */
export const UNIT_TOKENS: ReadonlySet<string> = new Set([
  'INCH', 'INCHES', 'IN', 'FT', 'FEET', 'FOOT', 'MTR', 'MTRS', 'METER', 'METRE', 'METERS', 'METRES', 'M', 'CM', 'MM', 'YARD', 'YARDS', 'YD',
  'KG', 'KGS', 'GM', 'GMS', 'GRAM', 'GRAMS', 'G', 'MG', 'LTR', 'LITRE', 'LITER', 'ML', 'PCS', 'PC', 'PIECE', 'PIECES', 'DOZEN', 'DZ', 'GROSS'
])

export interface NormalisedItem {
  /** The text exactly as typed (plain text of the name cell). */
  raw: string
  /** Uppercase, single-spaced, separators unified, notes removed. May be ''. */
  cleaned: string
  /** Bracket notes, uppercased, joined by ' | '. Not part of the key. '' when none. */
  note: string
  /** Cleaned tokens in typed order. */
  tokens: string[]
  /** Tokens that must match exactly (digits, sizes, fractions, units), in typed order. */
  protectedTokens: string[]
  /** Alphabetic tokens (the only ones a later fuzzy step may touch), in typed order. */
  wordTokens: string[]
  /** Order-insensitive key: tokens sorted, joined by a single space. '' for an empty name. */
  key: string
  /** Set when the line is a charge / less / advance / GST line and not goods. */
  nonProduct: { ruleId: string; label: string } | null
  /** True when there is no name at all (blank, or only a note). */
  empty: boolean
}

const NUM = '\\d+(?:\\.\\d+)?'
const SIZE_RE = new RegExp(`(${NUM})\\s*[X*\\u00D7]\\s*(?=${NUM})`, 'g')
const FRACTION_RE = /(\d+)\s*\/\s*(\d+)/g
const BRACKET_RE = /\(([^()]*)\)|\[([^\[\]]*)\]|\{([^{}]*)\}/g

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Splits `(note)` / `[note]` parts off. An unclosed bracket keeps its text as part of the name (nothing is lost). */
export function splitNotes(raw: string): { name: string; note: string } {
  const notes: string[] = []
  let name = raw
  // repeat so a nested pair `(A (B))` is peeled from the inside out
  for (let guard = 0; guard < 4; guard++) {
    let found = false
    name = name.replace(BRACKET_RE, (_m, a?: string, b?: string, c?: string) => {
      found = true
      const t = collapse((a ?? b ?? c ?? '').toUpperCase())
      if (t !== '') notes.push(t)
      return ' '
    })
    if (!found) break
  }
  return { name, note: notes.join(' | ') }
}

/** Step 1: the cleaned name, without the notes. */
export function cleanName(rawName: string): string {
  let s = rawName.toUpperCase().normalize('NFKC')
  // fractions first so the `/` survives: `1 / 2` -> `1/2`
  const fractions: string[] = []
  s = s.replace(FRACTION_RE, (_m, a: string, b: string) => {
    fractions.push(`${a}/${b}`)
    return ` \u0001${fractions.length - 1}\u0001 `
  })
  // sizes: `32 x 50`, `32*50`, `32x50x10` -> `32X50`; run twice so a three-part size joins fully
  s = s.replace(SIZE_RE, '$1X').replace(SIZE_RE, '$1X')
  // inch / foot marks after a number: `12"` -> `12 INCH`, `6'` -> `6 FT`
  s = s.replace(/(\d)\s*(?:"|\u201D|\u2033|'')/g, '$1 INCH ').replace(/(\d)\s*(?:'|\u2019|\u2032)/g, '$1 FT ')
  s = s.replace(/&/g, ' AND ')
  // every other separator / punctuation becomes a space; % . and digits stay (`18%`, `2.5`)
  s = s.replace(/[^\p{L}\p{N}\p{M}%.\u0001]+/gu, ' ')
  // a lone dot between letters/spaces is punctuation, a dot inside a number is a decimal
  s = s.replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
  s = s.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => fractions[Number(i)] ?? '')
  return collapse(s)
}

/** A token the matcher must never change: it has a digit (code, size, fraction, quantity) or is a unit word. */
export function isProtectedToken(token: string): boolean {
  return /\d/.test(token) || UNIT_TOKENS.has(token)
}

/** Step 2: which rule (if any) says this cleaned name is not goods. */
export function nonProductRule(cleaned: string): NonProductRule | null {
  if (cleaned === '') return null
  for (const r of NON_PRODUCT_RULES) if (r.pattern.test(cleaned)) return r
  return null
}

/** Steps 1-4 for one name. Never throws; any input string (even garbage) gives a result. */
export function normaliseItem(raw: string): NormalisedItem {
  const text = typeof raw === 'string' ? raw : ''
  const { name, note } = splitNotes(text)
  const cleaned = cleanName(name)
  const tokens = cleaned === '' ? [] : cleaned.split(' ')
  const protectedTokens = tokens.filter(isProtectedToken)
  const wordTokens = tokens.filter((t) => !isProtectedToken(t))
  const key = [...tokens].sort(compareTokens).join(' ')
  const rule = nonProductRule(cleaned)
  return {
    raw: text,
    cleaned,
    note,
    tokens,
    protectedTokens,
    wordTokens,
    key,
    nonProduct: rule ? { ruleId: rule.id, label: rule.label } : null,
    empty: cleaned === ''
  }
}

/** Plain code-point order (locale independent, so the key is the same on every PC). */
function compareTokens(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Convenience: the order-insensitive key of a name ('' when empty). */
export function itemKey(raw: string): string {
  return normaliseItem(raw).key
}

/** The key for which two names are the same product regardless of word order, case, spacing, punctuation and notes. */
export function sameItemKey(a: string, b: string): boolean {
  const ka = itemKey(a)
  return ka !== '' && ka === itemKey(b)
}
