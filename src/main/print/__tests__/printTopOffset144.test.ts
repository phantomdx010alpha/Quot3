import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { matrixBill } from '../../../shared/__fixtures__/printBills'
import { PAGE_MARGIN_MM } from '../../../shared/print/printConstants'
import { decideForBill } from '../../../shared/print/printFlow'
import { buildPrintModel, DEFAULT_PRINT_SETTINGS } from '../../../shared/print/printModel'
import { renderPrintHtml } from '../../../shared/print/template/renderHtml'
import type { Paper, PrintMode } from '../../../shared/types'
import { printFontBaseUrl } from '../template'
import { CHROME, chromeAvailable } from './layoutHarness'

/**
 * Phase 144 - REPRODUCE-FIRST, sandbox half. The real print HTML (same @page, same PDF options the app uses: preferCSSPageSize,
 * backgrounds, no header/footer) is rendered to PDF in headless Chromium and the FIRST TEXT's top edge is measured from the top of
 * every page with `pdftotext -bbox`. It must sit at the page margin (10 mm A4, 6 mm A5) plus at most the head's own text leading,
 * never more. This proves the TEMPLATE only; Electron's print() to a real printer is NOT run here (owner paper test).
 * QUOT3_PRINT_REPORT=1 prints the table recorded in PHASE_STATUS.md.
 */
const tool = (n: string): boolean => spawnSync(n, ['-v']).error === undefined
const ready = chromeAvailable() && tool('pdftotext') && tool('pdfinfo')
const run = ready ? describe : describe.skip
const root = join(__dirname, '..', '..', '..', '..', 'resources')
const COMPANY = { logo: '', name: 'Test Traders', phone: '0000000000', address: 'Test street' }
const PT_MM = 25.4 / 72

interface Ink { pages: number; firstYmm: number[]; widthMm: number; heightMm: number }
function measureInk(paper: Paper, mode: PrintMode, rows: number): Ink {
  const bill = matrixBill('non_gst', rows, 0)
  const decision = decideForBill(bill, mode, { forced: paper })
  const settings = mode === 'professional' ? { ...DEFAULT_PRINT_SETTINGS, company: COMPANY } : DEFAULT_PRINT_SETTINGS
  const html = renderPrintHtml(buildPrintModel(bill, mode, settings, decision), { fontBaseUrl: printFontBaseUrl(root) })
  const dir = mkdtempSync(join(tmpdir(), 'q3t144-'))
  const f = join(dir, 'p.html'), out = join(dir, 'p.pdf'), bb = join(dir, 'p.bbox.html')
  writeFileSync(f, html)
  spawnSync(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--no-pdf-header-footer', `--print-to-pdf=${out}`, 'file://' + f], { encoding: 'utf8' })
  if (!existsSync(out)) throw new Error('chromium produced no pdf')
  execFileSync('pdftotext', ['-bbox', out, bb])
  const xml = execFileSync('cat', [bb], { encoding: 'utf8' })
  const pageBlocks = xml.split('<page ').slice(1)
  const firstYmm = pageBlocks.map((b) => {
    const ys = [...b.matchAll(/<word xMin="[\d.]+" yMin="([\d.]+)"/g)].map((m) => Number(m[1]))
    return Math.min(...ys) * PT_MM
  })
  const w = /<page width="([\d.]+)" height="([\d.]+)"/.exec(xml)!
  return { pages: pageBlocks.length, firstYmm, widthMm: Number(w[1]) * PT_MM, heightMm: Number(w[2]) * PT_MM }
}

run('Phase 144 - first-ink Y of the template in headless-Chromium PDFs', () => {
  const cases: Array<[Paper, PrintMode, number]> = []
  for (const paper of ['A4', 'A5'] as const) for (const mode of ['rough', 'professional'] as const) for (const rows of [15, 16, 60]) cases.push([paper, mode, rows])
  const report: string[] = []
  for (const [paper, mode, rows] of cases) {
    it(`${paper} ${mode} ${rows} rows: every page's first text starts at the ${PAGE_MARGIN_MM[paper]} mm page margin, not lower`, () => {
      const r = measureInk(paper, mode, rows)
      const m = PAGE_MARGIN_MM[paper]
      report.push(`${paper} ${mode} ${rows} rows: pages=${r.pages} firstTextY(mm)=${r.firstYmm.map((v) => v.toFixed(2)).join(',')}`)
      if (process.env.QUOT3_PRINT_REPORT === '1') console.log(report[report.length - 1])
      expect(Math.abs(r.widthMm - (paper === 'A4' ? 210 : 148))).toBeLessThan(1.2)
      // The text box starts at the margin (a little below it for the first line's leading, a few tenths of a mm); 2.5 mm is the hard ceiling.
      for (const y of r.firstYmm) { expect(y).toBeGreaterThanOrEqual(m - 0.6); expect(y).toBeLessThanOrEqual(m + 2.5) }
      if (rows <= 16) expect(r.pages).toBe(1)
    }, 60_000)
  }
})
