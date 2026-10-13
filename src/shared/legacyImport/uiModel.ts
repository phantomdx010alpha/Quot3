import type { ClashChoice, ImportReport } from './plan'
import { formatHistoryDate } from '../history/historyList'

/**
 * Phase 86 - pure helpers behind the legacy-import UI and the History "Imported" features (LEGACY_IMPORT_SPEC sections 7-8).
 * No DOM, no Electron, no Node: the dialog, the History search and the report files all use these.
 */

/** What the renderer holds for a picked folder / file set: an opaque id and a label (never a path). */
export interface LegacyPickResult { sourceId: string; label: string; kind: 'folder' | 'files' }

/** Reading progress (`legacyImport:progress` event). */
export interface LegacyProgress { sourceId: string; done: number; total: number }

/** The old-app tags of one bill (null for a bill made here). */
export interface LegacyBillTag { legacyRef: string; importBatchId: string }

export type ReportFormat = 'text' | 'csv'

/** The dialog's default for a file in a clash group (spec 3.4: import / skip / import as new number). */
export const clashChoiceFor = (defaultAction: 'keep' | 'skip' | 'renumber'): ClashChoice => (defaultAction === 'keep' ? 'import' : defaultAction)

export const CLASH_CHOICE_LABEL: Readonly<Record<ClashChoice, string>> = { import: 'Import', skip: 'Skip', renumber: 'Import as new number' }

/** Digits at the end of a legacy reference: `BR1_106` -> `106`. */
export const legacyRefNumber = (ref: string): string => /(\d+)\s*$/.exec(ref)?.[1] ?? ''

/**
 * History search score of one (lower-cased) query word against a bill's legacy reference (`BR1_106`): the whole reference,
 * its trailing number (`106`, leading zeros ignored), then a plain contains. 0 = no match. Bills made here have no reference.
 */
export function legacyRefScore(token: string, legacyRef: string | undefined): number {
  if (!legacyRef || token === '') return 0
  const ref = legacyRef.toLowerCase()
  if (ref === token) return 850
  const num = legacyRefNumber(ref)
  if (/^\d+$/.test(token) && num !== '' && num.replace(/^0+(?=\d)/, '') === token.replace(/^0+(?=\d)/, '')) return 700
  if (ref.startsWith(token)) return 560
  return token.length >= 2 && ref.includes(token) ? 450 : 0
}

/** The note on the Create page header of an imported bill. */
export function importedNote(tag: LegacyBillTag, billDate: string): string {
  return `Imported from the old app \u00b7 old number ${tag.legacyRef}${billDate ? ` \u00b7 ${formatHistoryDate(billDate)}` : ''}`
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** The short "what will happen" lines under the Preview heading. */
export function previewLines(r: ImportReport): string[] {
  const out: string[] = []
  out.push(`${plural(r.filesFound, 'file', 'files')} found, ${r.filesRead} readable, ${plural(r.errors.length, 'file', 'files')} with a problem`)
  out.push(`${plural(r.created, 'bill', 'bills')} will be created, ${r.skipped.length} skipped (same bill twice or already imported), ${r.renumbered.length} given a new number`)
  if (r.poFirst !== null && r.poLast !== null) out.push(`Numbers used: ${r.poFirst} to ${r.poLast}. Next new bill after the import: ${r.nextPoAfter}`)
  out.push(`${plural(r.newParties, 'new customer', 'new customers')}, ${r.existingParties} already saved`)
  if (r.totalDifferences.length > 0) out.push(`${plural(r.totalDifferences.length, 'bill', 'bills')} where the recalculated total differs from the old total`)
  return out
}

const csvCell = (v: string | number): string => {
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The report as plain text (\"Save report as text\"). Contains party and file names: it is a local file the owner chooses to save. */
export function reportToText(r: ImportReport, meta: { sourceLabel: string; poPrefix: string; at?: string }): string {
  const L: string[] = []
  L.push('Quot3 - legacy import report')
  L.push(`Source: ${meta.sourceLabel}`)
  if (meta.at) L.push(`Date: ${meta.at}`)
  L.push('')
  for (const l of previewLines(r)) L.push(l)
  L.push(`Formats: ${r.formats.gst} GST, ${r.formats.nonGst} non-GST${r.formats.defaultMode > 0 ? ` (${r.formats.defaultMode} of them had the old default format)` : ''}`)
  L.push('')
  const sec = (title: string, rows: string[]): void => { if (rows.length > 0) { L.push(`${title} (${rows.length})`); for (const x of rows) L.push(`  ${x}`); L.push('') } }
  sec('Files with a problem', r.errors.map((e) => `${e.file}: ${e.error}`))
  sec('Skipped', r.skipped.map((s) => `${s.file}: ${s.detail}`))
  sec('Given a new number', r.renumbered.map((n) => `${n.file}: ${n.legacyRef} -> ${n.newPo} (${n.reason})`))
  sec('Same number in the old app', r.clashGroups.map((g) => `No. ${g.number}: ${g.files.map((f) => `${f.file} (${f.party}, ${f.date})`).join('; ')}`))
  sec('Total differs from the old app', r.totalDifferences.map((d) => `${d.file}: old ${d.legacy}, new ${d.recomputed}${d.note ? ` - ${d.note}` : ''}`))
  sec('Warnings', r.warnings)
  return `${L.join('\r\n')}\r\n`
}

/** The report as CSV: `section,file,detail`. */
export function reportToCsv(r: ImportReport): string {
  const rows: Array<[string, string, string]> = []
  for (const e of r.errors) rows.push(['problem', e.file, e.error])
  for (const s of r.skipped) rows.push(['skipped', s.file, s.detail])
  for (const n of r.renumbered) rows.push(['renumbered', n.file, `${n.legacyRef} -> ${n.newPo}: ${n.reason}`])
  for (const g of r.clashGroups) for (const f of g.files) rows.push(['same number', f.file, `No. ${g.number}; ${f.party}; ${f.date}; ${f.reason}`])
  for (const d of r.totalDifferences) rows.push(['total differs', d.file, `old ${d.legacy}; new ${d.recomputed}${d.note ? `; ${d.note}` : ''}`])
  for (const w of r.warnings) rows.push(['warning', '', w])
  return `${['section,file,detail', ...rows.map((x) => x.map(csvCell).join(','))].join('\r\n')}\r\n`
}

export const renderReport = (format: ReportFormat, r: ImportReport, meta: { sourceLabel: string; poPrefix: string; at?: string }): string =>
  format === 'csv' ? reportToCsv(r) : reportToText(r, meta)
