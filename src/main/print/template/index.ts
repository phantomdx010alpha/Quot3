/**
 * Phase 33 - main-side entry to the print template. The renderer itself is pure and lives in `shared/print/template`
 * (so the renderer-process dev preview can call it without importing `src/main`); this file adds the one thing that
 * needs Node: where the bundled fonts are on disk, and a one-call "bill -> HTML" for the print service (Phase 37).
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PaperDecision } from '../../../shared/paper/paperTypes'
import { buildPrintModel, type PrintSettings } from '../../../shared/print/printModel'
import { renderPrintHtml } from '../../../shared/print/template/renderHtml'
import type { Bill, PrintMode } from '../../../shared/types'

/** `resources/fonts` under the app root (dev) or the packaged resources dir (Phase 64 extraResources copies it there). */
export function printFontsDir(resourcesRoot: string): string {
  return join(resourcesRoot, 'fonts')
}

/** `file:///.../fonts` - the `fontBaseUrl` for a hidden print window. */
export function printFontBaseUrl(resourcesRoot: string): string {
  return pathToFileURL(printFontsDir(resourcesRoot)).href
}

export function renderBillHtml(bill: Bill, mode: PrintMode, settings: PrintSettings, decision: PaperDecision, resourcesRoot: string): string {
  return renderPrintHtml(buildPrintModel(bill, mode, settings, decision), { fontBaseUrl: printFontBaseUrl(resourcesRoot) })
}
