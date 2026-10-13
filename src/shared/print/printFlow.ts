import { decidePaper } from '../paper/paperRules'
import { simplePaperDecision, type PaperDecision } from '../paper/paperTypes'
import type { Bill, Paper, PrintMode } from '../types'
import { A4_DENSITY_TIERS, PAGE_MARGIN_MM, PAPER_MM } from './printConstants'
import { buildPrintModel, DEFAULT_PRINT_SETTINGS, type CompanyBlock, type PrintSettings } from './printModel'

/**
 * Phase 37 - the pure half of the print flow: how a bill + the user's choices become a `PaperDecision`, how Settings
 * become `PrintSettings`, the measured-overflow geometry, and what each dialog key means. No DOM, no Electron: the main
 * `printService` and the renderer dialog both call these, so what the dialog shows is what the print service does.
 */

/** `'auto'` = ignore the bill's saved paper override and let the rules decide (the dialog's A key). */
export type ForcedPaper = Paper | 'auto'

export interface DecideOptions {
  forced?: ForcedPaper | undefined
  /** The render-measure safety net saw A5 content overflow (PAPER_ENGINE_RULES §4). */
  measuredOverflow?: boolean | undefined
}

/** Item + adjustment rows that print (the same number the print model carries; footer and blank rows are not counted). */
export function printRowCount(bill: Bill, mode: PrintMode): number {
  return buildPrintModel(bill, mode, DEFAULT_PRINT_SETTINGS, simplePaperDecision('A5')).rowCount
}

/**
 * The paper decision for a bill. A forced size wins; with none given the bill's saved `paperOverride` counts as forced;
 * `'auto'` skips that override. Extra-column limits come from the format (via `decidePaper`).
 */
export function decideForBill(bill: Bill, mode: PrintMode, opts: DecideOptions = {}): PaperDecision {
  const forced = opts.forced === 'auto' ? undefined : opts.forced ?? bill.paperOverride ?? undefined
  return decidePaper({
    mode,
    formatId: bill.formatId,
    rowCount: printRowCount(bill, mode),
    extraColCount: bill.extraCols.length,
    ...(forced ? { forced } : {}),
    ...(opts.measuredOverflow ? { measuredOverflow: true } : {})
  })
}

/** Settings keys read by printing. Settings -> Print / Company screens arrive in Phase 48; until then the defaults apply. */
export const PRINT_SETTING_KEYS = { rupeeOnTotal: 'print.rupeeOnTotal', silent: 'print.silent', printer: 'print.printer', company: 'company.profile', hideAdjustmentsTotal: 'print.hideAdjustmentsTotal' } as const

export interface ResolvedPrintSettings {
  print: PrintSettings
  /** Print without the system dialog (only when a printer is also configured). */
  silent: boolean
  /** Windows printer name; '' = the system default / dialog choice. */
  printer: string
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
function companyFrom(v: unknown): CompanyBlock | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const name = str(o['name'], 200)
  if (name.trim() === '') return null
  const logo = str(o['logo'], 2_000_000)
  return { logo, name, phone: str(o['phone'], 100), address: str(o['address'], 500) }
}

/** Tolerant: a missing, corrupt or wrongly-typed setting falls back to its default, never throws. */
export function resolvePrintSettings(all: Record<string, unknown>): ResolvedPrintSettings {
  const rupee = all[PRINT_SETTING_KEYS.rupeeOnTotal]
  const printer = str(all[PRINT_SETTING_KEYS.printer], 300).trim()
  return {
    print: { rupeeOnTotal: typeof rupee === 'boolean' ? rupee : DEFAULT_PRINT_SETTINGS.rupeeOnTotal, hideAdjustmentsTotal: all[PRINT_SETTING_KEYS.hideAdjustmentsTotal] === true, company: companyFrom(all[PRINT_SETTING_KEYS.company]) },
    // Silent printing needs somewhere to send the job: no printer configured -> always show the system dialog.
    silent: all[PRINT_SETTING_KEYS.silent] === true && printer !== '',
    printer
  }
}

const PX_PER_MM = 96 / 25.4

/** Width of the printable area in CSS px - the hidden window is sized to this so wrapping matches the printed page. */
export function contentWidthPx(paper: Paper): number {
  return Math.round((PAPER_MM[paper].w - 2 * PAGE_MARGIN_MM[paper]) * PX_PER_MM)
}

/** Height of the printable area of ONE page in CSS px. */
export function contentHeightPx(paper: Paper): number {
  return Math.round((PAPER_MM[paper].h - 2 * PAGE_MARGIN_MM[paper]) * PX_PER_MM)
}

/** Run inside the hidden window after load (fonts ready): the bottom edge of the sheet in CSS px. */
export const MEASURE_SCRIPT = `(async()=>{try{await document.fonts.ready}catch(e){}const s=document.querySelector('.q3p-sheet');if(!s)return -1;return Math.ceil(s.getBoundingClientRect().bottom+window.scrollY)})()`

/** True when the rendered content is taller than one page of `paper` (1 px of rounding slack). A missing sheet (-1) is not an overflow. */
export function isOverflow(paper: Paper, bottomPx: number): boolean {
  return Number.isFinite(bottomPx) && bottomPx > contentHeightPx(paper) + 1
}

/**
 * Phase 40 - the densest-needed A4 tier: the first tier (0 = normal) whose measured sheet bottom fits one page. `measure(tier)`
 * returns the bottom edge in CSS px. When even the densest tier overflows, returns the densest tier with `fits: false`
 * (the content then flows onto a second page; the caller keeps the page count honest).
 */
export async function fitDensity(measure: (tier: number) => Promise<number>, tiers: number = A4_DENSITY_TIERS.length): Promise<{ tier: number; fits: boolean }> {
  for (let t = 0; t < tiers; t++) if (!isOverflow('A4', await measure(t))) return { tier: t, fits: true }
  return { tier: tiers - 1, fits: false }
}

/** The Electron `pageSize` value for a paper. */
export const printPageSize = (paper: Paper): 'A4' | 'A5' => paper

// --- Phase 144: print position -------------------------------------------------------------------------------------

/** Phase 144 (i): the paper as an explicit width/height in MICRONS (Electron's `pageSize` object form) - no driver-side name lookup. */
export function printPageSizeMicrons(paper: Paper): { width: number; height: number } {
  return { width: Math.round(PAPER_MM[paper].w * 1000), height: Math.round(PAPER_MM[paper].h * 1000) }
}

/** Phase 144 (ii): which Electron `margins.marginType` the print call uses. `none` is the long-standing default. */
export type PrintMarginType = 'none' | 'default' | 'printableArea'
export const PRINT_MARGIN_TYPES: readonly PrintMarginType[] = ['none', 'default', 'printableArea']
export const parsePrintMarginType = (v: unknown): PrintMarginType => (PRINT_MARGIN_TYPES as readonly unknown[]).includes(v) ? (v as PrintMarginType) : 'none'

/** The exact options handed to `webContents.print`. Pure, so a test pins them. Geometry (size) comes from the paper, never from the printer. */
export function buildElectronPrintOptions(o: { paper: Paper; silent: boolean; deviceName: string; marginType?: PrintMarginType | undefined }): {
  silent: boolean; printBackground: true; deviceName: string; pageSize: { width: number; height: number }; margins: { marginType: PrintMarginType }; landscape: false
} {
  return { silent: o.silent, printBackground: true, deviceName: o.deviceName, pageSize: printPageSizeMicrons(o.paper), margins: { marginType: o.marginType ?? 'none' }, landscape: false }
}

/** Phase 144: one diagnostic line for `QUOT3_PRINT_DEBUG=1`. Geometry and device only - never bill content, names or phones. */
export function printDebugLine(d: { action: 'print' | 'pdf'; paper: Paper; pageSize: unknown; marginType?: string; windowWidthPx: number; contentBottomPx: number; deviceName: string }): string {
  const m = PAGE_MARGIN_MM[d.paper]
  return `[print-debug] ${d.action} paper=${d.paper} pageSize=${JSON.stringify(d.pageSize)} marginType=${d.marginType ?? 'n/a'} atPage="@page{size:${d.paper} portrait;margin:${m}mm}" window=${d.windowWidthPx}px contentBottom=${d.contentBottomPx}px device=${d.deviceName === '' ? '(default/dialog)' : d.deviceName}`
}

// --- dialog keys --------------------------------------------------------------------------------------------------

export type PrintDialogAction = 'print' | 'needAck' | 'ack' | 'force4' | 'force5' | 'auto' | 'pdf'

export interface DialogKeyEvent { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }

/**
 * What a key does in the print dialog (Esc is the dialog's own close). Enter prints the suggested size - except when the
 * decision `requiresAck` and the owner has not yet acknowledged it: then Enter does nothing but ask for the explicit
 * confirmation key (Y). 4 / 5 force A4 / A5, A returns to the rules' choice. Modified keys are never ours.
 */
export function printDialogKey(e: DialogKeyEvent, ctx: { requiresAck: boolean; acked: boolean }): PrintDialogAction | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null
  if (e.key === 'Enter') return ctx.requiresAck && !ctx.acked ? 'needAck' : 'print'
  switch (e.key.toLowerCase()) {
    case '4': return 'force4'
    case '5': return 'force5'
    case 'a': return 'auto'
    case 's': return 'pdf' // Phase 38: save as PDF (same acknowledgement rule as printing, enforced by the caller)
    case 'y': return ctx.requiresAck && !ctx.acked ? 'ack' : null
    default: return null
  }
}

/** One line for the dialog header: what will print. */
export function decisionSummary(d: PaperDecision): string {
  return `${d.size}${d.pages > 1 ? ` - ${d.pages} pages` : ''}`
}

// --- PDF export (Phase 38) ------------------------------------------------------------------------------------------

/** `printToPDF` options: the template's `@page` size and margins are authoritative, backgrounds (zebra/highlights) are kept, no browser header/footer. */
export const PDF_OPTIONS = { preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false } as const

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const FILE_STEM_MAX = 60

/** Make one path segment safe on Windows: illegal characters and controls -> '-', whitespace collapsed, no trailing dots/spaces, no device names. */
function safeStem(raw: string): string {
  // eslint-disable-next-line no-control-regex
  let s = raw.replace(/\s+/g, ' ').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim()
  s = Array.from(s).slice(0, FILE_STEM_MAX).join('').replace(/[. ]+$/g, '').replace(/^[-. ]+/, '')
  if (s === '') return ''
  return WIN_RESERVED.test(s) ? `_${s}` : s
}

/** Default PDF file name: `<PO or party name>-<date>.pdf` (PO number wins; a never-saved bill has none). */
export function pdfFileName(bill: { poNumber: string; party: { name: string }; billDate: string }): string {
  const stem = safeStem(bill.poNumber) || safeStem(bill.party.name) || 'Quotation'
  const date = /^\d{4}-\d{2}-\d{2}$/.test(bill.billDate) ? bill.billDate : ''
  return `${stem}${date ? `-${date}` : ''}.pdf`
}

/** True for a path that ends in `.pdf` (any case). */
export const isPdfPath = (p: string): boolean => /\.pdf$/i.test(p) && p.length > 4

/** Number of pages in a PDF, counted from its page objects (Chromium/Skia write plain, uncompressed page dictionaries). */
export function countPdfPages(bytes: Uint8Array): number {
  let text = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) text += String.fromCharCode(...bytes.subarray(i, i + CH))
  return (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length
}

// --- Phase 144 follow-up: PDF-first printing -------------------------------------------------------------------------------

/** How Print reaches the printer. `pdf` (default): render the SAME PDF Save PDF makes, then send that file to the printer (no Chromium page setup in between). `html`: the older `webContents.print` path, kept as the fallback. */
export type PrintRoute = 'pdf' | 'html'
export const parsePrintRoute = (v: unknown): PrintRoute => (v === 'html' ? 'html' : 'pdf')

/** Phase 144b: what the Print button does. `viewer` (default) opens the full-page PDF in the PC's default PDF app (Acrobat / Edge / Foxit) and the owner presses Print there; `direct` sends it to the printer; `browser` is the older HTML print. */
export type PrintMethod = 'viewer' | 'direct' | 'browser'
export const parsePrintMethod = (v: unknown): PrintMethod => (v === 'direct' || v === 'browser' ? v : 'viewer')
/** `QUOT3_PRINT_ROUTE` (owner paper-test switch) wins over the setting when it is set: `html` = browser, `pdf` = direct. */
export const effectivePrintMethod = (setting: unknown, envRoute: unknown): PrintMethod => (envRoute === 'html' ? 'browser' : envRoute === 'pdf' ? 'direct' : parsePrintMethod(setting))

/** Options for `pdf-to-printer` (SumatraPDF). Actual size (no scaling, no fit-to-page), explicit paper, portrait. A configured printer prints silently; otherwise the viewer's own print dialog opens so the owner picks the printer. */
export interface PdfPrintOptions { printer?: string; silent: boolean; printDialog: boolean; scale: 'noscale'; paperSize: Paper; orientation: 'portrait' }
export function buildPdfPrintOptions(o: { paper: Paper; silent: boolean; deviceName: string }): PdfPrintOptions {
  const silent = o.silent && o.deviceName !== ''
  return { ...(o.deviceName !== '' ? { printer: o.deviceName } : {}), silent, printDialog: !silent, scale: 'noscale', paperSize: o.paper, orientation: 'portrait' }
}
