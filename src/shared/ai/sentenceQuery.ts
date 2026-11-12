import { D } from '../money'
import { UNIT_TOKENS } from '../items/normalise'
import { createPartyIndex } from '../party/fuzzy'
import { normalizePartyName, type PartyLite } from '../party/partyLite'

/**
 * Phase 228 (M22) - plain-sentence parser (pure: no Electron, Node, DOM, model, network or I/O; MILESTONE22_DESIGN 9).
 * Turns "ruby tomato to Sharma last month above 5000" into a `StructuredQuery` plus explanation chips (each with the source
 * span it came from, so the UI can let the owner fix or remove one). Deterministic; it never throws: whatever it does not
 * understand stays in `itemText`.
 *
 * Understood (English words only [A6]): dates (today, yesterday, this / last week, this / last month, this / last year,
 * last N days / weeks / months, a month name with optional year, "5 oct", "oct 5", dd/mm/yyyy, dd-mm-yyyy, dd/mm, dd-mm,
 * all day-first, and ranges "A to B" / "from A to B" / "between A and B"); amounts ("above / over / more than / under /
 * below / less than / up to N", with commas, rs / rupee sign, k, lakh, crore; also > and <); format (gst, non gst, with /
 * without gst); the party (a marker word to / for / from / party / customer followed by up to 4 words, or a whole customer
 * name typed on its own). Amounts are decimal strings (decimal.js); dates are ISO `YYYY-MM-DD`.
 */

export interface SentenceCustomer { id: string; name: string; phone?: string }
export interface SentenceOptions { /** `YYYY-MM-DD`, injected so tests are deterministic. */ today: string; customers?: readonly SentenceCustomer[] }

export interface PartyCandidate { id: string; name: string }
export interface StructuredQuery {
  party?: { id: string; name: string; candidates?: PartyCandidate[] }
  dateRange?: { from: string; to: string }
  amount?: { op: 'gt' | 'lt'; value: string }
  format?: 'gst' | 'nongst'
  itemText: string
}
export type QueryChipKind = 'party' | 'date' | 'amount' | 'format' | 'item'
export interface QueryChip {
  kind: QueryChipKind
  label: string
  value: string
  removable: boolean
  /** Half-open character span `[start, end)` of the ORIGINAL text this chip was read from. */
  span: { start: number; end: number }
  /** Party chip only: the other choices when the name was ambiguous. */
  candidates?: PartyCandidate[]
}
export interface ParsedSentence { query: StructuredQuery; chips: QueryChip[] }

export const SENTENCE_MAX_CHARS = 400
export const PARTY_CANDIDATE_MAX = 5
const PARTY_WINDOW_MAX = 4

// ---------------------------------------------------------------- date arithmetic (integers only, UTC)
interface Ymd { y: number; m: number; d: number }
const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
const iso = (t: Ymd): string => `${pad(t.y, 4)}-${pad(t.m)}-${pad(t.d)}`
const daysIn = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate()
const validDay = (y: number, m: number, d: number): boolean => m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m)
function parseIso(s: string): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const t = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
  return validDay(t.y, t.m, t.d) ? t : null
}
function addDays(t: Ymd, n: number): Ymd {
  const dt = new Date(Date.UTC(t.y, t.m - 1, t.d + n))
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
}
const cmp = (a: Ymd, b: Ymd): number => a.y - b.y || a.m - b.m || a.d - b.d
/** Month arithmetic on a first-of-month: shift by n months. */
function shiftMonth(y: number, m: number, n: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + n
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 }
}
const monthRange = (y: number, m: number): { from: Ymd; to: Ymd } => ({ from: { y, m, d: 1 }, to: { y, m, d: daysIn(y, m) } })

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const MONTH_SHORT_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_WORD = '(?:january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)'
function monthIndex(word: string): number {
  const w = word.toLowerCase()
  const i = MONTH_FULL.indexOf(w)
  return i >= 0 ? i + 1 : MONTHS.indexOf(w.slice(0, 3)) + 1
}

// ---------------------------------------------------------------- date atoms
/** A date phrase found in the text. `abs` atoms are already resolved; the others wait for the year rule. */
interface Atom {
  start: number
  end: number
  /** Whole-period atoms (a month, a week ...) cover a span; day atoms cover one day. */
  kind: 'abs' | 'day' | 'month'
  y?: number
  m?: number
  d?: number
  from?: Ymd
  to?: Ymd
}

const NUM_FULL = /(?<![\d/.-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d/])/gi
const NUM_SHORT = /(?<![\w/.])(\d{1,2})[/-](\d{1,2})(?![/.]\d)(?!\d)/gi
const DAY_MONTH = new RegExp(`(?<![\\d\\w])(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_WORD})\\b(?:\\s+(\\d{4})\\b)?`, 'gi')
const MONTH_DAY = new RegExp(`\\b(${MONTH_WORD})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)(?:,?\\s+(\\d{4})\\b)?`, 'gi')
const MONTH_YEAR = new RegExp(`\\b(${MONTH_WORD})\\b(?:\\s+(\\d{4})\\b)?`, 'gi')
const KEYWORD = /\b(today|yesterday|(?:this|last|previous|current)\s+(?:week|month|year)|(?:last|past|previous)\s+(\d{1,3})\s+(day|week|month)s?)\b/gi
const UNIT_AFTER = /^\s*(?:"|[a-z]+)/i

/** Fractions and sizes read like dates ("1/2 inch", "3/4"): never a date. */
function looksLikeSize(text: string, m: RegExpExecArray): boolean {
  const a = Number(m[1])
  const b = Number(m[2])
  if (m[0].includes('/') && a < b && [2, 4, 8, 16].includes(b)) return true
  const after = text.slice(m.index + m[0].length)
  const u = UNIT_AFTER.exec(after)
  if (u) {
    const word = u[0].trim().replace(/"/g, 'IN').toUpperCase()
    if (UNIT_TOKENS.has(word)) return true
  }
  return false
}

function findAtoms(text: string, today: Ymd): Atom[] {
  const out: Atom[] = []
  const push = (a: Atom): void => { out.push(a) }
  const run = (re: RegExp, f: (m: RegExpExecArray) => Atom | null): void => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[0] === '') { re.lastIndex++; continue }
      const a = f(m)
      if (a) push(a)
    }
  }
  run(NUM_FULL, (m) => {
    const d = Number(m[1]); const mo = Number(m[2]); let y = Number(m[3])
    if (m[3]!.length === 2) y += 2000
    if (!validDay(y, mo, d)) return null
    return { start: m.index, end: m.index + m[0].length, kind: 'day', y, m: mo, d }
  })
  run(NUM_SHORT, (m) => {
    const d = Number(m[1]); const mo = Number(m[2])
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || looksLikeSize(text, m)) return null
    if (d > daysIn(2024, mo)) return null // 31/02 never exists in any year
    return { start: m.index, end: m.index + m[0].length, kind: 'day', m: mo, d }
  })
  run(DAY_MONTH, (m) => {
    const d = Number(m[1]); const mo = monthIndex(m[2]!)
    if (mo < 1 || d < 1 || d > daysIn(2024, mo)) return null
    const y = m[3] ? Number(m[3]) : undefined
    if (y !== undefined && !validDay(y, mo, d)) return null
    return { start: m.index, end: m.index + m[0].length, kind: 'day', y, m: mo, d }
  })
  run(MONTH_DAY, (m) => {
    const d = Number(m[2]); const mo = monthIndex(m[1]!)
    if (mo < 1 || d < 1 || d > daysIn(2024, mo)) return null
    const y = m[3] ? Number(m[3]) : undefined
    if (y !== undefined && !validDay(y, mo, d)) return null
    return { start: m.index, end: m.index + m[0].length, kind: 'day', y, m: mo, d }
  })
  run(MONTH_YEAR, (m) => {
    const word = m[1]!.toLowerCase()
    const hasYear = m[2] !== undefined
    // "may" is also a verb: a month only after in / of / for / during, or with a year.
    if (word === 'may' && !hasYear && !/\b(?:in|of|for|during)\s+$/i.test(text.slice(0, m.index))) return null
    return { start: m.index, end: m.index + m[0].length, kind: 'month', y: hasYear ? Number(m[2]) : undefined, m: monthIndex(word) }
  })
  run(KEYWORD, (m) => {
    const w = m[1]!.toLowerCase().replace(/\s+/g, ' ')
    const base = { start: m.index, end: m.index + m[0].length, kind: 'abs' as const }
    if (w === 'today') return { ...base, from: today, to: today }
    if (w === 'yesterday') { const y = addDays(today, -1); return { ...base, from: y, to: y } }
    if (m[2] !== undefined) {
      const n = Number(m[2])
      if (n < 1) return null
      const unit = m[3]!.toLowerCase()
      if (unit === 'day') return { ...base, from: addDays(today, -(n - 1)), to: today }
      if (unit === 'week') return { ...base, from: addDays(today, -(7 * n - 1)), to: today }
      const s = shiftMonth(today.y, today.m, -n)
      return { ...base, from: { y: s.y, m: s.m, d: Math.min(today.d, daysIn(s.y, s.m)) }, to: today }
    }
    const [which, unit] = w.split(' ') as [string, string]
    const back = which === 'last' || which === 'previous'
    if (unit === 'week') {
      const wd = (new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay() + 6) % 7 // Monday = 0 [A]
      const mon = addDays(today, -wd - (back ? 7 : 0))
      return { ...base, from: mon, to: addDays(mon, 6) }
    }
    if (unit === 'month') {
      const s = shiftMonth(today.y, today.m, back ? -1 : 0)
      const r = monthRange(s.y, s.m)
      return { ...base, from: r.from, to: r.to }
    }
    const y = today.y - (back ? 1 : 0)
    return { ...base, from: { y, m: 1, d: 1 }, to: { y, m: 12, d: 31 } }
  })

  // Longest-first, earliest-first; drop anything overlapping an accepted atom.
  out.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
  const kept: Atom[] = []
  for (const a of out) if (!kept.some((k) => a.start < k.end && k.start < a.end)) kept.push(a)
  return kept
}

/** Day / month atoms without a year get the latest year that is not in the future [A]. */
function resolveSingle(a: Atom, today: Ymd, yearHint?: number): { from: Ymd; to: Ymd } {
  if (a.kind === 'abs') return { from: a.from!, to: a.to! }
  const m = a.m!
  if (a.kind === 'month') {
    let y = a.y ?? yearHint
    if (y === undefined) y = m > today.m ? today.y - 1 : today.y
    return monthRange(y, m)
  }
  const d = a.d!
  let y = a.y ?? yearHint
  if (y === undefined) {
    y = today.y
    if (cmp({ y, m, d }, today) > 0) y -= 1
  }
  if (!validDay(y, m, d)) { // 29 Feb in a non-leap year: step back to the latest leap year [A]
    while (!validDay(y, m, d)) y -= 1
  }
  return { from: { y, m, d }, to: { y, m, d } }
}

const RANGE_GLUE = /^\s*(?:to|till|until|through|thru|and|-|\u2013|\u2014)\s*$/i
const RANGE_LEAD = /\b(?:from|between)\s+$/i

interface DateHit { start: number; end: number; from: Ymd; to: Ymd }

function pickDate(text: string, today: Ymd): DateHit | null {
  const atoms = findAtoms(text, today)
  if (atoms.length === 0) return null
  const a = atoms[0]!
  const b = atoms[1]
  const lead = RANGE_LEAD.exec(text.slice(0, a.start))
  const start0 = lead ? a.start - lead[0].length : a.start
  if (b && a.kind !== 'abs' && b.kind !== 'abs' && RANGE_GLUE.test(text.slice(a.end, b.start))) {
    const endR = resolveSingle(b, today, a.y)
    // Start shares the end's year unless it carries its own; a start after the end falls back one year.
    let startR = resolveSingle(a, today, b.y ?? endR.to.y)
    if (a.y === undefined && cmp(startR.from, endR.to) > 0 && startR.from.m !== endR.to.m) startR = resolveSingle(a, today, endR.to.y - 1)
    let from = startR.from
    let to = endR.to
    if (cmp(from, to) > 0) { const t = from; from = to; to = t }
    return { start: start0, end: b.end, from, to }
  }
  if (a.kind === 'abs') return { start: start0, end: a.end, from: a.from!, to: a.to! }
  const r = resolveSingle(a, today)
  return { start: start0, end: a.end, from: r.from, to: r.to }
}

function dateLabel(from: Ymd, to: Ymd, today: Ymd): string {
  const yr = (t: Ymd): string => (t.y === today.y ? '' : ` ${t.y}`)
  const one = (t: Ymd): string => `${t.d} ${MONTH_SHORT_LABEL[t.m - 1]}${yr(t)}`
  if (cmp(from, to) === 0) return one(from)
  if (from.y === to.y && from.m === to.m) return `${from.d}-${to.d} ${MONTH_SHORT_LABEL[to.m - 1]}${yr(to)}`
  if (from.y === to.y) return `${from.d} ${MONTH_SHORT_LABEL[from.m - 1]} - ${one(to)}`
  return `${from.d} ${MONTH_SHORT_LABEL[from.m - 1]} ${from.y} - ${to.d} ${MONTH_SHORT_LABEL[to.m - 1]} ${to.y}`
}

// ---------------------------------------------------------------- amount, format
const NUM = '(\\d[\\d,]*(?:\\.\\d+)?|\\.\\d+)'
const SUFFIX = '(k|thousand|lakhs?|lacs?|crores?|cr)?'
const MONEY = `(?:(?:rs\\.?|inr|\\u20b9)\\s*)?${NUM}\\s*${SUFFIX}\\b`
const AMOUNT_RE = new RegExp(
  `(?<![\\w])(?:(above|over|more\\s+than|greater\\s+than|bigger\\s+than|exceeding|>)|(under|below|less\\s+than|lower\\s+than|smaller\\s+than|up\\s*to|upto|within|<))\\s*${MONEY}`,
  'i'
)
const MULT: Record<string, string> = { k: '1000', thousand: '1000', lakh: '100000', lakhs: '100000', lac: '100000', lacs: '100000', crore: '10000000', crores: '10000000', cr: '10000000' }

function findAmount(text: string, taken: readonly Span[]): { start: number; end: number; op: 'gt' | 'lt'; value: string } | null {
  const re = new RegExp(AMOUNT_RE.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const span = { start: m.index, end: m.index + m[0].length }
    if (overlaps(span, taken)) continue
    const raw = m[3]!.replace(/,/g, '')
    let v: ReturnType<typeof D>
    try { v = D(raw.startsWith('.') ? `0${raw}` : raw) } catch { continue }
    const suf = m[4]?.toLowerCase()
    if (suf && MULT[suf]) v = v.times(MULT[suf]!)
    return { ...span, op: m[1] ? 'gt' : 'lt', value: v.toFixed() }
  }
  return null
}

const FORMAT_RES: ReadonlyArray<readonly [RegExp, 'gst' | 'nongst']> = [
  [/(?<![\w])(?:non[\s-]?gst|without\s+gst|no\s+gst|ngst)(?![\w])/i, 'nongst'],
  [/(?<![\w])(?:with\s+gst|gst)(?![\w])/i, 'gst']
]
function findFormat(text: string, taken: readonly Span[]): { start: number; end: number; format: 'gst' | 'nongst' } | null {
  let best: { start: number; end: number; format: 'gst' | 'nongst' } | null = null
  for (const [re0, format] of FORMAT_RES) {
    const re = new RegExp(re0.source, 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const span = { start: m.index, end: m.index + m[0].length }
      if (overlaps(span, taken)) continue
      if (!best || span.start < best.start) best = { ...span, format }
      break
    }
  }
  return best
}

// ---------------------------------------------------------------- spans and words
interface Span { start: number; end: number }
const overlaps = (s: Span, list: readonly Span[]): boolean => list.some((t) => s.start < t.end && t.start < s.end)
interface Word { text: string; start: number; end: number }
function wordsOf(text: string, taken: readonly Span[]): Word[] {
  const out: Word[] = []
  const re = /[^\s,;]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const w = { text: m[0], start: m.index, end: m.index + m[0].length }
    if (!overlaps(w, taken)) out.push(w)
  }
  return out
}

// ---------------------------------------------------------------- party
const PARTY_MARKERS: ReadonlySet<string> = new Set(['to', 'for', 'from', 'party', 'customer', 'customers'])
const PARTY_STOP: ReadonlySet<string> = new Set([
  'bill', 'bills', 'invoice', 'invoices', 'sale', 'sales', 'quote', 'quotes', 'quotation', 'quotations', 'where', 'with', 'having',
  'and', 'or', 'in', 'on', 'at', 'dated', 'date', 'above', 'over', 'under', 'below', 'to', 'for', 'from', 'party', 'customer', 'customers'
])
const EDGE_FILLER: ReadonlySet<string> = new Set([
  'show', 'find', 'search', 'list', 'get', 'give', 'me', 'all', 'the', 'bills', 'bill', 'invoices', 'invoice', 'quotations', 'quotation',
  'quotes', 'quote', 'sales', 'sold', 'having', 'where', 'with', 'and', 'in', 'on', 'of', 'for', 'to', 'from', 'by', 'a', 'an', 'party', 'customer'
])

const cleanWord = (w: string): string => normalizePartyName(w).replace(/[^\p{L}\p{N}]+/gu, '')

/** One letter inserted / removed / changed (both long enough, no digits): the typo allowance. */
function closeWords(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 5 || b.length < 5 || /\d/.test(a) || /\d/.test(b) || Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  const [s, l] = a.length < b.length ? [a, b] : [b, a]
  return s.slice(i) === l.slice(i + 1)
}

/** Every typed word must start (or nearly spell) a word of the customer's name; keeps the loose fuzzy index from over-matching. */
function wordsFit(typed: readonly string[], name: string): boolean {
  const nameWords = normalizePartyName(name).split(' ').map(cleanWord).filter((w) => w !== '')
  return typed.every((t) => nameWords.some((n) => n.startsWith(t) || closeWords(t, n)))
}

interface PartyHit { start: number; end: number; id: string; name: string; candidates?: PartyCandidate[] }

function matchPhrase(index: ReturnType<typeof createPartyIndex>, typed: readonly string[], phrase: string, customers: readonly PartyLite[]): { id: string; name: string; candidates?: PartyCandidate[] } | null {
  const norm = normalizePartyName(phrase)
  const exact = customers.filter((c) => normalizePartyName(c.name) === norm)
  const hits = exact.length > 0 ? exact : index.search(phrase, 12).filter((p) => wordsFit(typed, p.name))
  if (hits.length === 0) return null
  const top = hits[0]!
  if (hits.length === 1) return { id: top.id, name: top.name }
  return { id: top.id, name: top.name, candidates: hits.slice(0, PARTY_CANDIDATE_MAX).map((p) => ({ id: p.id, name: p.name })) }
}

function findParty(text: string, taken: readonly Span[], customers: readonly PartyLite[]): PartyHit | null {
  if (customers.length === 0) return null
  const words = wordsOf(text, taken)
  if (words.length === 0) return null
  const index = createPartyIndex(customers)
  const adjacent = (a: Word, b: Word): boolean => !taken.some((t) => t.start >= a.end && t.end <= b.start)

  // 1. a marker word, then the longest run of words that names a customer
  for (let i = 0; i < words.length; i++) {
    if (!PARTY_MARKERS.has(words[i]!.text.toLowerCase())) continue
    const run: Word[] = []
    for (let j = i + 1; j < words.length && run.length < PARTY_WINDOW_MAX; j++) {
      const w = words[j]!
      const prev = run[run.length - 1] ?? words[i]!
      if (!adjacent(prev, w)) break
      if (PARTY_STOP.has(w.text.toLowerCase())) break
      run.push(w)
    }
    for (let k = run.length; k >= 1; k--) {
      const win = run.slice(0, k)
      const typed = win.map((w) => cleanWord(w.text)).filter((w) => w !== '')
      if (typed.length === 0) continue
      const r = matchPhrase(index, typed, win.map((w) => w.text).join(' '), customers)
      if (r) return { start: words[i]!.start, end: win[k - 1]!.end, ...r }
    }
  }
  // 2. a whole customer name typed on its own (exact only: item words never steal a party)
  for (let len = Math.min(PARTY_WINDOW_MAX, words.length); len >= 1; len--) {
    for (let s = 0; s + len <= words.length; s++) {
      const win = words.slice(s, s + len)
      let ok = true
      for (let q = 1; q < win.length; q++) if (!adjacent(win[q - 1]!, win[q]!)) ok = false
      if (!ok) continue
      const norm = normalizePartyName(win.map((w) => w.text).join(' '))
      const exact = customers.filter((c) => normalizePartyName(c.name) === norm)
      if (exact.length === 0) continue
      const top = exact[0]!
      return { start: win[0]!.start, end: win[len - 1]!.end, id: top.id, name: top.name, ...(exact.length > 1 ? { candidates: exact.slice(0, PARTY_CANDIDATE_MAX).map((p) => ({ id: p.id, name: p.name })) } : {}) }
    }
  }
  return null
}

// ---------------------------------------------------------------- the parser
function emptyQuery(text: string): ParsedSentence {
  const t = text.replace(/\s+/g, ' ').trim()
  const chips: QueryChip[] = t === '' ? [] : [{ kind: 'item', label: `Item: ${t}`, value: t, removable: false, span: { start: 0, end: text.length } }]
  return { query: { itemText: t }, chips }
}

/** Parse one typed sentence. Never throws. */
export function parseSentence(input: string, opts: SentenceOptions): ParsedSentence {
  const text = typeof input === 'string' ? input.slice(0, SENTENCE_MAX_CHARS) : ''
  try {
    const today = parseIso(opts?.today ?? '')
    if (!today) return emptyQuery(text)
    const taken: Span[] = []
    const chips: QueryChip[] = []
    const query: StructuredQuery = { itemText: '' }

    const date = pickDate(text, today)
    if (date) {
      taken.push({ start: date.start, end: date.end })
      query.dateRange = { from: iso(date.from), to: iso(date.to) }
      chips.push({ kind: 'date', label: `Date: ${dateLabel(date.from, date.to, today)}`, value: `${query.dateRange.from}..${query.dateRange.to}`, removable: true, span: { start: date.start, end: date.end } })
    }
    const amount = findAmount(text, taken)
    if (amount) {
      taken.push({ start: amount.start, end: amount.end })
      query.amount = { op: amount.op, value: amount.value }
      chips.push({ kind: 'amount', label: `Amount: ${amount.op === 'gt' ? 'above' : 'below'} ${amount.value}`, value: `${amount.op}:${amount.value}`, removable: true, span: { start: amount.start, end: amount.end } })
    }
    const fmt = findFormat(text, taken)
    if (fmt) {
      taken.push({ start: fmt.start, end: fmt.end })
      query.format = fmt.format
      chips.push({ kind: 'format', label: `Format: ${fmt.format === 'gst' ? 'GST' : 'Non-GST'}`, value: fmt.format, removable: true, span: { start: fmt.start, end: fmt.end } })
    }
    const customers: PartyLite[] = (opts.customers ?? []).map((c) => ({ id: c.id, name: c.name, phone: c.phone ?? '', address: '', transport: '' }))
    const party = findParty(text, taken, customers)
    if (party) {
      taken.push({ start: party.start, end: party.end })
      query.party = { id: party.id, name: party.name, ...(party.candidates ? { candidates: party.candidates } : {}) }
      chips.push({ kind: 'party', label: `Party: ${party.name}${party.candidates ? ' (pick one)' : ''}`, value: party.id, removable: true, span: { start: party.start, end: party.end }, ...(party.candidates ? { candidates: party.candidates } : {}) })
    }

    // The rest is the item text, minus filler words at its two edges.
    const rest = wordsOf(text, taken)
    let lo = 0
    let hi = rest.length
    while (lo < hi && EDGE_FILLER.has(rest[lo]!.text.toLowerCase())) lo++
    while (hi > lo && EDGE_FILLER.has(rest[hi - 1]!.text.toLowerCase())) hi--
    const kept = rest.slice(lo, hi)
    query.itemText = kept.map((w) => w.text).join(' ')
    if (kept.length > 0) {
      chips.push({ kind: 'item', label: `Item: ${query.itemText}`, value: query.itemText, removable: false, span: { start: kept[0]!.start, end: kept[kept.length - 1]!.end } })
    }
    chips.sort((a, b) => a.span.start - b.span.start)
    return { query, chips }
  } catch {
    return emptyQuery(text)
  }
}
