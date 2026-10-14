import type { Bill, Paper, PrintMode } from '../../shared/types'
import type { PaperDecision } from '../../shared/paper/paperTypes'
import { buildPrintModel, type PrintSettings } from '../../shared/print/printModel'
import { parsePrintMethod, type PrintMethod, countPdfPages, decideForBill, fitDensity, isOverflow, isPdfPath, pdfFileName, resolvePrintSettings, type ForcedPaper } from '../../shared/print/printFlow'
import { fitCapFor, fitScaleSearch } from '../../shared/print/fitScale'
import { renderPrintHtml } from '../../shared/print/template/renderHtml'
import { AppError } from '../ipc/envelope'
import type { Logger } from '../logger'
import { printFontBaseUrl } from '../print/template'
import type { SettingsService } from './settingsService'

/**
 * Phase 37 - the print service. It owns the decision flow (rules -> render -> measure -> re-decide) and hands the final
 * HTML to a `PrintPort` (the Electron hidden window in the app, a stub in tests). Nothing here imports Electron.
 */
export interface PrintPort {
  /** Render `html` in a hidden window sized for `paper` and return the bottom edge of the sheet in CSS px. Rejects when it cannot render. */
  measure(html: string, paper: Paper): Promise<number>
  /** Send `html` to the printer. `cancelled` = the owner closed the system print dialog (not an error). */
  print(html: string, o: { paper: Paper; silent: boolean; deviceName: string; method?: PrintMethod }): Promise<{ ok: true } | { ok: false; cancelled: boolean; reason: string }>
  /** Phase 144 follow-up: optional, fire-and-forget - get the hidden render window ready (the print dialog opens, so a print / measure is likely next). */
  warm?(): void
  /** Phase 38: render `html` to PDF bytes at `paper` (`preferCSSPageSize`: the template's own @page size and margins). Rejects when it cannot render. */
  toPdf(html: string, paper: Paper): Promise<Uint8Array>
}

/** Phase 38 - the file side of PDF export (Electron: Save dialog, fs, shell). Injected so the service stays testable. */
export interface PdfFilePort {
  /** Ask where to save; `null` = the owner closed the dialog. */
  chooseSavePath(defaultName: string): Promise<string | null>
  write(path: string, bytes: Uint8Array): Promise<void>
  exists(path: string): boolean
  /** Open in the OS default viewer; '' = ok, otherwise the failure text (Electron `shell.openPath` convention). */
  open(path: string): Promise<string>
}

export interface PrintRequest {
  bill: Bill
  mode: PrintMode
  forced?: ForcedPaper | undefined
}

export interface DecideResult {
  decision: PaperDecision
  /** What the renderer needs to draw the same preview (company block, rupee flag). */
  settings: PrintSettings
  /** The A5 content overflowed when measured, so the decision was re-run with `measuredOverflow`. */
  switchedByMeasure: boolean
  /** The measurement could not run (the decision is the rules' answer, unverified). */
  measureFailed: boolean
  /** Phase 73: true when no measurement ran (the answer is the pure paper engine's, not yet checked against real text wrapping). */
  provisional?: boolean
  /** Phase 40: the A4 density tier the one-page A4 bill was fitted at (0 = the normal style). The preview must render with it. */
  density: number
  /** Phase 148: the fit-to-page factor the bill was rendered at (1 = the normal size). The preview must render with it. */
  fit: number
}

export interface PrintResult {
  printed: boolean
  cancelled: boolean
  decision: PaperDecision
  switchedByMeasure: boolean
}

export interface PdfResult {
  saved: boolean
  cancelled: boolean
  filePath: string | null
  pages: number
  decision: PaperDecision
  switchedByMeasure: boolean
}

export interface PrintService {
  decide(req: PrintRequest): Promise<DecideResult>
  /** Phase 73: the rules' answer + the settings the preview needs, with NO hidden-window measurement (returns in milliseconds; `provisional: true`). The dialog opens from this and `decide` then refines it. */
  decideQuick(req: PrintRequest): Promise<DecideResult>
  print(req: PrintRequest & { ack?: boolean | undefined }): Promise<PrintResult>
  /** Phase 38: the same decision and HTML as `print`, written to a PDF file. */
  pdf(req: PrintRequest & { ack?: boolean | undefined; savePath?: string | undefined }): Promise<PdfResult>
  openPdf(filePath: string): Promise<void>
  /** Phase 39: the final decision and its HTML (no ack, no printing) - the image service captures exactly this. */
  resolveOutput(req: PrintRequest): Promise<{ html: string; decision: PaperDecision; switchedByMeasure: boolean }>
}

export function createPrintService(deps: { port: PrintPort; settings: SettingsService; /** Phase 48: turns the saved logo file name into a data URL for the template. */ logoDataUrl?: (fileName: string) => string; resourcesRoot: string; files?: PdfFilePort; log?: Pick<Logger, 'warn' | 'info'> }): PrintService {
  const fontBaseUrl = printFontBaseUrl(deps.resourcesRoot)
  const render = (bill: Bill, mode: PrintMode, settings: PrintSettings, decision: PaperDecision, density = 0, fit = 1): string =>
    renderPrintHtml(buildPrintModel(bill, mode, settings, decision), { fontBaseUrl, density, ...(fit > 1 ? { fit } : {}) })

  // Phase 144 follow-up (speed): the measured answer is a pure function of (bill, mode, forced, print settings). The dialog already
  // measured it when it opened, so Print / Save PDF / copy-image reuse it instead of opening up to five hidden windows again.
  // Measurement failures are never cached (they retry). Small, short-lived.
  type Measured = Pick<DecideResult, 'decision' | 'switchedByMeasure' | 'measureFailed' | 'density' | 'fit'> & { html: string }
  const MEASURE_CACHE_MAX = 4, MEASURE_CACHE_TTL_MS = 120_000
  const measured = new Map<string, { at: number; v: Measured }>()
  const keyOf = (req: PrintRequest, settings: PrintSettings, fitSettings: unknown): string => JSON.stringify([req.bill, req.mode, req.forced ?? null, settings, fitSettings])

  /** Rules, then (only for an unforced A5 result) the measured-overflow safety net; returns the final decision and its HTML. */
  async function resolve(req: PrintRequest, quick = false): Promise<DecideResult & { html: string; resolved: ReturnType<typeof resolvePrintSettings> }> {
    const resolved = resolvePrintSettings(deps.settings.getAll())
    const co = resolved.print.company
    const settings = co && co.logo !== '' && !co.logo.includes(':') && deps.logoDataUrl ? { ...resolved.print, company: { ...co, logo: deps.logoDataUrl(co.logo) } } : resolved.print
    let decision = decideForBill(req.bill, req.mode, { forced: req.forced })
    let html = render(req.bill, req.mode, settings, decision)
    let switchedByMeasure = false
    let measureFailed = false
    if (quick) return { decision, settings, switchedByMeasure, measureFailed, density: 0, fit: 1, html, resolved, provisional: true }
    const key = keyOf(req, settings, resolved.fit)
    const hit = measured.get(key)
    if (hit && Date.now() - hit.at < MEASURE_CACHE_TTL_MS) return { ...hit.v, settings, resolved }
    if (decision.size === 'A5' && decision.suggested === 'A5' && !isForced(req)) {
      try {
        const bottom = await deps.port.measure(html, 'A5')
        if (isOverflow('A5', bottom)) {
          decision = decideForBill(req.bill, req.mode, { forced: req.forced, measuredOverflow: true })
          html = render(req.bill, req.mode, settings, decision)
          switchedByMeasure = true
        }
      } catch (err) {
        measureFailed = true
        deps.log?.warn('Print overflow measurement failed; using the rules decision', { err: err instanceof Error ? err.message : String(err) })
      }
    }
    // Phase 40: a bill the engine puts on ONE A4 page is fitted to it by trying denser type tiers (the owner's 80 / 70 rows rule).
    let density = 0
    if (decision.size === 'A4' && decision.pages === 1 && !measureFailed) {
      try {
        density = (await fitDensity((t) => deps.port.measure(render(req.bill, req.mode, settings, decision, t), 'A4'))).tier
        if (density > 0) html = render(req.bill, req.mode, settings, decision, density)
      } catch (err) {
        measureFailed = true
        deps.log?.warn('A4 fit measurement failed; using the normal density', { err: err instanceof Error ? err.message : String(err) })
      }
    }
    // Phase 148: fit-to-page. Only a bill that is ONE page at the normal size and was not density-squeezed; thresholds are not touched.
    // Off (Settings > Print) = never measured, never scaled = today's output exactly. A failed measurement keeps the normal size.
    let fit = 1
    if (resolved.fit.enabled && !measureFailed && density === 0 && decision.pages === 1) {
      try {
        const size = decision.size
        fit = (await fitScaleSearch((s) => deps.port.measure(render(req.bill, req.mode, settings, decision, 0, s), size), size, fitCapFor(resolved.fit, size))).scale
        if (fit > 1) html = render(req.bill, req.mode, settings, decision, 0, fit)
      } catch (err) {
        fit = 1
        deps.log?.warn('Fit-to-page measurement failed; using the normal size', { err: err instanceof Error ? err.message : String(err) })
      }
    }
    if (!measureFailed) {
      measured.set(key, { at: Date.now(), v: { decision, switchedByMeasure, measureFailed, density, fit, html } })
      while (measured.size > MEASURE_CACHE_MAX) measured.delete(measured.keys().next().value as string)
    }
    return { decision, settings, switchedByMeasure, measureFailed, density, fit, html, resolved }
  }

  return {
    async decide(req) {
      const { html: _html, resolved: _r, ...out } = await resolve(req)
      return out
    },
    async decideQuick(req) {
      deps.port.warm?.()
      const { html: _html, resolved: _r, ...out } = await resolve(req, true)
      return out
    },
    async print(req) {
      const r = await resolve(req)
      if (r.decision.requiresAck && req.ack !== true) throw new AppError('VALIDATION', 'Acknowledge the print warning before printing')
      const out = await deps.port.print(r.html, { paper: r.decision.size, silent: r.resolved.silent, deviceName: r.resolved.printer, method: parsePrintMethod(deps.settings.getAll()['print.method']) })
      if (!out.ok && !out.cancelled) throw new AppError('PRINT_FAILED', out.reason ? `Printing failed: ${out.reason}` : 'Printing failed')
      return { printed: out.ok, cancelled: !out.ok, decision: r.decision, switchedByMeasure: r.switchedByMeasure }
    },
    async pdf(req) {
      const files = deps.files
      if (!files) throw new AppError('PRINT_FAILED', 'PDF export is not available')
      if (req.savePath !== undefined && !isPdfPath(req.savePath)) throw new AppError('VALIDATION', 'The PDF file name must end in .pdf')
      const r = await resolve(req)
      if (r.decision.requiresAck && req.ack !== true) throw new AppError('VALIDATION', 'Acknowledge the print warning before saving the PDF')
      // Ask where to save BEFORE rendering the PDF: closing the dialog then costs nothing.
      const target = req.savePath ?? (await files.chooseSavePath(pdfFileName({ poNumber: req.bill.poNumber, party: req.bill.party, billDate: req.bill.billDate })))
      if (target === null) return { saved: false, cancelled: true, filePath: null, pages: 0, decision: r.decision, switchedByMeasure: r.switchedByMeasure }
      const withExt = isPdfPath(target) ? target : `${target}.pdf`
      let bytes: Uint8Array
      try {
        bytes = await deps.port.toPdf(r.html, r.decision.size)
        await files.write(withExt, bytes)
      } catch (err) {
        deps.log?.warn('PDF export failed', { err: err instanceof Error ? err.message : String(err) })
        throw new AppError('PRINT_FAILED', `Could not save the PDF: ${err instanceof Error ? err.message : 'unknown error'}`)
      }
      return { saved: true, cancelled: false, filePath: withExt, pages: countPdfPages(bytes), decision: r.decision, switchedByMeasure: r.switchedByMeasure }
    },
    async resolveOutput(req) {
      const { html, decision, switchedByMeasure } = await resolve(req)
      return { html, decision, switchedByMeasure }
    },
    async openPdf(filePath) {
      const files = deps.files
      if (!files) throw new AppError('PRINT_FAILED', 'PDF export is not available')
      if (!isPdfPath(filePath)) throw new AppError('VALIDATION', 'Only .pdf files can be opened here')
      if (!files.exists(filePath)) throw new AppError('NOT_FOUND', 'That PDF no longer exists')
      const failure = await files.open(filePath)
      if (failure !== '') throw new AppError('PRINT_FAILED', `Could not open the PDF: ${failure}`)
    }
  }
}

/** A size the owner forced (dialog key or the bill's saved override) is never second-guessed by the measurement. */
function isForced(req: PrintRequest): boolean {
  if (req.forced === 'auto') return false
  return (req.forced ?? req.bill.paperOverride ?? null) !== null
}
