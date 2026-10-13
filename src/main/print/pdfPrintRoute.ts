import type { Paper } from '../../shared/types'
import { buildPdfPrintOptions, type PdfPrintOptions } from '../../shared/print/printFlow'

/**
 * Phase 144 follow-up - print by sending the PDF Save PDF makes straight to the printer. Pure orchestration with injected
 * effects (Electron / pdf-to-printer / fs live in `electronPrintPort.ts`), so it is unit-tested. Never logs bill content.
 */
export interface PdfRouteDeps {
  /** The same PDF bytes Save PDF produces for this html + paper. */
  toPdf(html: string, paper: Paper): Promise<Uint8Array>
  /** Write bytes to a fresh temp file and return its path. */
  writeTemp(bytes: Uint8Array): string
  removeTemp(path: string): void
  /** Send a PDF file to the printer (pdf-to-printer). Rejects on failure. */
  printFile(path: string, options: PdfPrintOptions): Promise<void>
}
export type PdfRouteResult = { ok: true } | { ok: false; reason: string }

export async function printViaPdf(deps: PdfRouteDeps, html: string, o: { paper: Paper; silent: boolean; deviceName: string }): Promise<PdfRouteResult> {
  let file = ''
  try {
    const bytes = await deps.toPdf(html, o.paper)
    file = deps.writeTemp(bytes)
    await deps.printFile(file, buildPdfPrintOptions(o))
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  } finally {
    if (file !== '') { try { deps.removeTemp(file) } catch { /* temp file already gone */ } }
  }
}
