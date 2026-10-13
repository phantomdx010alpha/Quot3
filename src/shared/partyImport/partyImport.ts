import type { PartyLite } from '../party/partyLite'
import { normalizePartyName } from '../party/partyLite'
import { PARTY_FIELD_MAX } from '../partyFields'

/** Phase 47 - pure rules of the party Excel import (header spellings, row planning, duplicates). No Node, no ExcelJS. */

export type ImportField = 'name' | 'phone' | 'address' | 'transport'
export const IMPORT_FIELDS: readonly ImportField[] = ['name', 'phone', 'address', 'transport']
export const IMPORT_FIELD_LABEL: Readonly<Record<ImportField, string>> = { name: 'Party name', phone: 'Phone', address: 'Address', transport: 'Transport' }

/** 0-based column index in the sheet, or null = not imported. */
export type ColumnMapping = Record<ImportField, number | null>
export type ImportMode = 'skip' | 'update'

export const IMPORT_SAMPLE_ROWS = 20
export const IMPORT_MAX_ROWS = 20_000
export const IMPORT_DETAIL_MAX = 200
export const IMPORT_HEADER_SCAN = 10

export type PlannedStatus = 'new' | 'update' | 'duplicate' | 'repeated' | 'invalid' | 'blank'

export interface PlannedRow {
  /** Row number as the owner sees it in Excel (1-based). */
  row: number
  status: PlannedStatus
  name: string
  phone: string
  address: string
  transport: string
  reason: string
  /** Existing party this row matches (duplicate / update). */
  targetId?: string
  /** Fields an update changes. */
  changes?: ImportField[]
}

export interface PlanSummary { new: number; update: number; duplicate: number; repeated: number; invalid: number; blank: number }

/** Header spellings (compared after `headerKey`). Add a spelling here, nowhere else. */
const ALIASES: Readonly<Record<ImportField, readonly string[]>> = {
  name: ['name', 'partyname', 'party', 'customername', 'customer', 'companyname', 'company', 'firmname', 'firm', 'clientname', 'client', 'accountname', 'account', 'ledgername', 'ledger', 'nameofparty', 'partysname', 'tradename', 'buyer', 'buyername', 'billto', 'billtoname'],
  phone: ['phone', 'phoneno', 'phonenumber', 'mobile', 'mobileno', 'mobilenumber', 'mob', 'mobno', 'contact', 'contactno', 'contactnumber', 'cell', 'cellno', 'telephone', 'tel', 'whatsapp', 'whatsappno', 'phno', 'ph'],
  address: ['address', 'addr', 'address1', 'fulladdress', 'location', 'city', 'place', 'billingaddress', 'billtoaddress', 'registeredaddress'],
  transport: ['transport', 'transporter', 'transportname', 'transportation', 'lorry', 'lorrytransport', 'shipvia', 'carrier', 'deliveryvia', 'goodstransport']
}

/** "Party Name" / "PARTY_NAME " / "Party-name." all become `partyname`. */
export function headerKey(h: string): string {
  return h.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

export function emptyMapping(): ColumnMapping { return { name: null, phone: null, address: null, transport: null } }

/** Best-guess mapping from the header cells: the first column whose spelling matches a field, no column used twice. */
export function autoDetectMapping(headers: readonly string[]): ColumnMapping {
  const keys = headers.map(headerKey)
  const out = emptyMapping()
  const used = new Set<number>()
  for (const f of IMPORT_FIELDS) {
    // exact alias first (in alias priority order), so "Customer Name" beats a later "Company"
    for (const alias of ALIASES[f]) {
      const i = keys.findIndex((k, idx) => k === alias && !used.has(idx))
      if (i >= 0) { out[f] = i; used.add(i); break }
    }
  }
  return out
}

/** How many fields the header row matches; used to find the header row inside the first rows. */
export function headerScore(cells: readonly string[]): number {
  const m = autoDetectMapping(cells)
  return IMPORT_FIELDS.reduce((n, f) => n + (m[f] === null ? 0 : 1), 0)
}

/** 1-based header row: the best-scoring (needs a Name match) of the first rows, else the first non-empty row, else 1. */
export function detectHeaderRow(rows: readonly (readonly string[])[]): number {
  let best = 0
  let bestScore = 0
  for (let i = 0; i < Math.min(rows.length, IMPORT_HEADER_SCAN); i++) {
    const cells = rows[i]!
    const m = autoDetectMapping(cells)
    if (m.name === null) continue
    const s = headerScore(cells)
    if (s > bestScore) { best = i + 1; bestScore = s }
  }
  if (best > 0) return best
  const firstFilled = rows.findIndex((r) => r.some((c) => c.trim() !== ''))
  return firstFilled >= 0 ? firstFilled + 1 : 1
}

/** A spreadsheet cell value (string, number, Date, rich text, hyperlink, formula result...) as plain text. */
export function valueToText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return Number.isFinite(v) ? (Number.isInteger(v) ? v.toFixed(0) : String(v)) : ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (Array.isArray(o.richText)) return (o.richText as { text?: unknown }[]).map((r) => (typeof r.text === 'string' ? r.text : '')).join('')
    if ('result' in o) return valueToText(o.result)
    if (typeof o.text === 'string') return o.text
    if (o.text && typeof o.text === 'object') return valueToText(o.text)
    if (typeof o.hyperlink === 'string') return o.hyperlink
    if ('error' in o) return ''
  }
  return ''
}

/** Imported cell text -> stored field text (one line for name / phone / transport; address keeps single spaces and commas). */
export function cleanCell(field: ImportField, raw: string): string {
  const oneLine = raw.replace(/[\r\n\t\u00a0]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (field === 'address') return raw.replace(/\u00a0/g, ' ').split(/\r?\n/).map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join(', ')
  return oneLine
}

/** Digits only; 10+ digits compare on the last 10 (drops +91 / 0). Under 7 digits is not a usable key. */
export function phoneKey(phone: string): string {
  const d = phone.replace(/\D+/g, '')
  if (d.length < 7) return ''
  return d.length > 10 ? d.slice(-10) : d
}

const cell = (row: readonly string[], i: number | null): string => (i === null ? '' : row[i] ?? '')

/**
 * Plan every data row against the parties that already exist. `rows` are the data rows (below the header);
 * `firstRowNumber` is the sheet row number of rows[0]. Same name (normalised) = same party, because names are unique
 * among live parties. A same-phone-different-name match never blocks a row; it only adds a note.
 */
export function planImport(input: {
  rows: readonly (readonly string[])[]
  firstRowNumber: number
  mapping: ColumnMapping
  existing: readonly PartyLite[]
  mode: ImportMode
}): PlannedRow[] {
  const { rows, firstRowNumber, mapping, existing, mode } = input
  const byNorm = new Map<string, PartyLite>()
  const byPhone = new Map<string, PartyLite>()
  for (const p of existing) {
    const n = normalizePartyName(p.name)
    if (!byNorm.has(n)) byNorm.set(n, p)
    const k = phoneKey(p.phone)
    if (k && !byPhone.has(k)) byPhone.set(k, p)
  }
  const seen = new Map<string, number>()
  const out: PlannedRow[] = []
  rows.forEach((r, i) => {
    const row = firstRowNumber + i
    const name = cleanCell('name', cell(r, mapping.name))
    const phone = cleanCell('phone', cell(r, mapping.phone))
    const address = cleanCell('address', cell(r, mapping.address))
    const transport = cleanCell('transport', cell(r, mapping.transport))
    const base = { row, name, phone, address, transport }
    if (!name && !phone && !address && !transport) { out.push({ ...base, status: 'blank', reason: 'Empty row' }); return }
    if (!name) { out.push({ ...base, status: 'invalid', reason: 'No party name' }); return }
    const tooLong = IMPORT_FIELDS.find((f) => base[f].length > PARTY_FIELD_MAX[f])
    if (tooLong) { out.push({ ...base, status: 'invalid', reason: `${IMPORT_FIELD_LABEL[tooLong]} is too long (max ${PARTY_FIELD_MAX[tooLong]} characters)` }); return }
    const norm = normalizePartyName(name)
    const firstSeen = seen.get(norm)
    if (firstSeen !== undefined) { out.push({ ...base, status: 'repeated', reason: `Same name as row ${firstSeen} (first one wins)` }); return }
    seen.set(norm, row)
    const match = byNorm.get(norm)
    if (!match) {
      const k = phoneKey(phone)
      const same = k ? byPhone.get(k) : undefined
      out.push({ ...base, status: 'new', reason: same ? `Same phone as existing "${same.name}"` : '' })
      return
    }
    if (mode === 'skip') {
      const differs = phoneKey(phone) !== '' && phoneKey(match.phone) !== '' && phoneKey(phone) !== phoneKey(match.phone)
      out.push({ ...base, status: 'duplicate', targetId: match.id, reason: differs ? 'Already exists (phone differs)' : 'Already exists' })
      return
    }
    // update: a non-blank imported value replaces the saved one; a blank cell never clears anything
    const changes = (['name', 'phone', 'address', 'transport'] as const).filter((f) => {
      const next = base[f]
      return next !== '' && next !== match[f]
    })
    if (changes.length === 0) out.push({ ...base, status: 'duplicate', targetId: match.id, reason: 'Already exists, nothing new' })
    else out.push({ ...base, status: 'update', targetId: match.id, changes, reason: `Updates ${changes.map((c) => IMPORT_FIELD_LABEL[c].toLowerCase()).join(', ')}` })
  })
  return out
}

export function summarizePlan(rows: readonly PlannedRow[]): PlanSummary {
  const s: PlanSummary = { new: 0, update: 0, duplicate: 0, repeated: 0, invalid: 0, blank: 0 }
  for (const r of rows) s[r.status]++
  return s
}

/** One sentence for the import report. */
export function describeReport(r: { created: number; updated: number; skipped: number; invalid: number }): string {
  const parts = [`${r.created} added`, `${r.updated} updated`, `${r.skipped} skipped`]
  if (r.invalid > 0) parts.push(`${r.invalid} with problems`)
  return parts.join(', ')
}

export interface PartyImportPreview {
  fileName: string
  sheets: string[]
  sheet: string
  headerRow: number
  headers: string[]
  mapping: ColumnMapping
  sample: string[][]
  totalRows: number
  summary: PlanSummary
  rows: PlannedRow[]
}
export interface PartyImportReport { importId: string; created: number; updated: number; skipped: number; invalid: number; details: PlannedRow[] }
export interface PartyImportSummary { id: string; at: string; fileName: string; created: number; updated: number; skipped: number; invalid: number; undone: boolean }
export interface PartyImportUndoResult { removed: number; restored: number; kept: number }
