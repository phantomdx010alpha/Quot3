/**
 * Phase 84 - tolerant reader of ONE legacy bill file (LEGACY_IMPORT_SPEC section 1 / 10). Pure: takes the file text, never throws,
 * never trusts the file name. Unknown keys are ignored; what could not be mapped is counted in `ignored` for the report.
 */
export const MAX_FILE_BYTES = 2 * 1024 * 1024
export const MAX_ITEMS = 500
export const MAX_FILES = 20000

export interface IgnoredCounts {
  unknownFormatTags: number
  badNumbers: number
  otherHighlights: number
  markedNoCounterpart: number
  adjustmentExtras: number
  extraColumnsBeyondLimit: number
  badRanges: number
}
export const emptyIgnored = (): IgnoredCounts => ({ unknownFormatTags: 0, badNumbers: 0, otherHighlights: 0, markedNoCounterpart: 0, adjustmentExtras: 0, extraColumnsBeyondLimit: 0, badRanges: 0 })

const KNOWN_MODES: ReadonlySet<string> = new Set(['manual', 'gst', 'default'])

export interface LegacyItem {
  kind: 'item' | 'adjustment'
  name: string
  qty: string | null
  rate: string | null
  amt: string | null
  gst: string | null
  /** redbold ranges, as given (clamped later). */
  ranges: Array<{ start: number; end: number }>
  highlightName: boolean
  /** Per legacy extra column: text and marked flag. */
  extras: Array<{ text: string; marked: boolean }>
}

export interface LegacyBill {
  billNoText: string
  /** Digits after the last `_` of `bill_no`. */
  legacyNumber: number
  /** ISO date and the time when the file had one (HH:MM:SS), else null. */
  isoDate: string
  time: string | null
  party: string
  phone: string
  transport: string
  gstin: string
  formatMode: string
  extraHeaders: string[]
  items: LegacyItem[]
  /** Stored total, used by the report only; null when unreadable. */
  storedTotal: string | null
  ignored: IgnoredCounts
  warnings: string[]
}

export type ParsedFile = { ok: true; bill: LegacyBill } | { ok: false; error: string }

const asText = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')

/** Number or text -> canonical decimal string; blank / missing -> null; junk -> null and counted. */
export function legacyDecimal(v: unknown, ign?: IgnoredCounts): string | null {
  if (v === null || v === undefined) return null
  let s: string
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) { if (ign) ign.badNumbers++; return null }
    s = String(v)
  } else if (typeof v === 'string') s = v.replace(/,/g, '').trim()
  else { if (ign) ign.badNumbers++; return null }
  if (s === '') return null
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) { if (ign) ign.badNumbers++; return null }
  return canonical(s)
}

/** Plain decimal text, no exponent, no trailing zeros, no `-0`. Exact (string based), not via JS numbers. */
function canonical(s: string): string {
  let t = s.replace(/^\+/, '')
  const m = /^(-?)(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i.exec(t)
  if (!m) return t
  let [, sign = '', int = '', frac = '', exp = '0'] = m
  let e = parseInt(exp, 10)
  let digits = int + frac
  let point = int.length + e
  if (point < 0) { digits = '0'.repeat(-point) + digits; point = 0 }
  if (point > digits.length) digits = digits + '0'.repeat(point - digits.length)
  let ip = digits.slice(0, point).replace(/^0+/, '')
  const fp = digits.slice(point).replace(/0+$/, '')
  if (ip === '') ip = '0'
  t = fp === '' ? ip : `${ip}.${fp}`
  return t === '0' ? '0' : sign + t
}

export function parseLegacyDate(raw: string): { iso: string; time: string | null } | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})(?: (\d{2}):(\d{2}):(\d{2}))?$/.exec(raw.trim())
  if (!m) return null
  const d = +m[1]!, mo = +m[2]!, y = +m[3]!
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  if (mo < 1 || mo > 12 || d < 1 || d > dim || y < 1900 || y > 2200) return null
  let time: string | null = null
  if (m[4] !== undefined) {
    if (+m[4] > 23 || +m[5]! > 59 || +m[6]! > 59) return null
    time = `${m[4]}:${m[5]}:${m[6]}`
  }
  return { iso: `${m[3]}-${m[2]}-${m[1]}`, time }
}

/** `bill_no` -> the digits after the last `_` ("BR1_BR1_BR1_228" -> 228). null when there are none. */
export function legacyBillNumber(billNo: unknown): { text: string; number: number } | null {
  const text = typeof billNo === 'number' ? (Number.isInteger(billNo) ? String(billNo) : '') : typeof billNo === 'string' ? billNo.trim() : ''
  if (text === '') return null
  const last = text.slice(text.lastIndexOf('_') + 1)
  const m = /(\d+)$/.exec(last)
  if (!m || m[1]!.length > 9) return null
  const n = parseInt(m[1]!, 10)
  return n > 0 ? { text, number: n } : null
}

const cellText = (v: unknown): string => {
  if (typeof v === 'number') return Number.isFinite(v) ? canonical(String(v)) : ''
  if (typeof v !== 'string') return ''
  const t = v.trim()
  return /^-?\d+\.0+$/.test(t) ? t.replace(/\.0+$/, '') : t
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

export function parseLegacyFile(text: string, byteLength: number = text.length): ParsedFile {
  if (byteLength > MAX_FILE_BYTES) return { ok: false, error: 'The file is larger than 2 MB.' }
  let j: unknown
  try { j = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) } catch { return { ok: false, error: 'Not valid JSON.' } }
  const top = obj(j)
  if (!top) return { ok: false, error: 'Not a bill file (the top level is not an object).' }
  for (const k of ['bill_no', 'date', 'party', 'items']) if (!(k in top)) return { ok: false, error: `Missing "${k}".` }
  const no = legacyBillNumber(top['bill_no'])
  if (!no) return { ok: false, error: 'The bill number has no digits.' }
  const dt = typeof top['date'] === 'string' ? parseLegacyDate(top['date']) : null
  if (!dt) return { ok: false, error: `The date "${asText(top['date'])}" is not DD-MM-YYYY.` }
  const party = asText(top['party']).trim()
  if (party === '') return { ok: false, error: 'The party name is blank.' }
  if (!Array.isArray(top['items'])) return { ok: false, error: '"items" is not a list.' }
  if (top['items'].length > MAX_ITEMS) return { ok: false, error: `More than ${MAX_ITEMS} items.` }
  const ign = emptyIgnored()
  const warnings: string[] = []
  const headersRaw = Array.isArray(top['extra_headers']) ? top['extra_headers'] : []
  const extraHeaders = headersRaw.map((h) => asText(h))
  const formatMode = asText(top['format_mode']).trim().toLowerCase()
  if (formatMode === 'default') warnings.push('Format "default" imported as non-GST.')
  else if (!KNOWN_MODES.has(formatMode)) warnings.push(`Unknown format "${formatMode}" imported as non-GST.`)
  const items: LegacyItem[] = []
  for (const raw of top['items']) {
    const it = obj(raw)
    if (!it) { warnings.push('An item that is not an object was skipped.'); continue }
    const isAdj = it['kind'] === 'adjustment'
    const fmts = obj(it['formats'])
    const ranges: LegacyItem['ranges'] = []
    const nameFmt = fmts ? fmts['name'] : undefined
    if (Array.isArray(nameFmt)) {
      for (const r of nameFmt) {
        const o = obj(r)
        if (!o) { ign.badRanges++; continue }
        if (o['tag'] !== 'redbold') { ign.unknownFormatTags++; continue }
        const s = o['start'], e = o['end']
        if (typeof s !== 'number' || typeof e !== 'number' || !Number.isFinite(s) || !Number.isFinite(e)) { ign.badRanges++; continue }
        ranges.push({ start: s, end: e })
      }
    }
    if (fmts) for (const k of Object.keys(fmts)) if (k !== 'name' && Array.isArray(fmts[k]) && (fmts[k] as unknown[]).length) ign.unknownFormatTags += (fmts[k] as unknown[]).length
    const hl = obj(it['highlights'])
    let highlightName = false
    if (hl) for (const [k, v] of Object.entries(hl)) { if (v === true) { if (k === 'name') highlightName = true; else ign.otherHighlights++ } }
    const mk = obj(it['marked'])
    if (mk) for (const [k, v] of Object.entries(mk)) if (v === true && !/^manual_\d+$/.test(k)) ign.markedNoCounterpart++
    const arr = Array.isArray(it['extras']) ? (it['extras'] as unknown[]) : []
    const n = Math.max(extraHeaders.length, arr.length)
    const extras: LegacyItem['extras'] = []
    for (let i = 0; i < n; i++) {
      const direct = it[`manual_${i}`]
      const t = direct !== undefined && cellText(direct) !== '' ? cellText(direct) : cellText(arr[i])
      extras.push({ text: t, marked: mk ? mk[`manual_${i}`] === true : false })
    }
    items.push(isAdj
      ? { kind: 'adjustment', name: asText(it['label']), qty: null, rate: null, amt: legacyDecimal(it['value'], ign), gst: null, ranges, highlightName, extras }
      : { kind: 'item', name: asText(it['name']), qty: legacyDecimal(it['qty'], ign), rate: legacyDecimal(it['rate'], ign), amt: legacyDecimal(it['amt'], ign), gst: legacyDecimal(it['gst'], ign), ranges, highlightName, extras })
  }
  return {
    ok: true,
    bill: {
      billNoText: no.text, legacyNumber: no.number, isoDate: dt.iso, time: dt.time, party,
      phone: asText(top['phone']).trim(), transport: asText(top['transport']).trim(), gstin: asText(top['gst']).trim(),
      formatMode, extraHeaders, items, storedTotal: legacyDecimal(top['total']), ignored: ign, warnings
    }
  }
}
