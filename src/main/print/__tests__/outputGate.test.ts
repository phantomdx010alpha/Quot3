import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { matrixBill, printFixture } from '../../../shared/__fixtures__/printBills'
import { IMAGE_PADDING_PX, pngSize } from '../../../shared/print/imageFlow'
import { buildPrintModel, DEFAULT_PRINT_SETTINGS } from '../../../shared/print/printModel'
import { decideForBill, fitDensity, isOverflow } from '../../../shared/print/printFlow'
import { renderPrintHtml } from '../../../shared/print/template/renderHtml'
import type { Bill, Paper, PrintMode } from '../../../shared/types'
import { printFontBaseUrl } from '../template'
import { CHROME, chromeAvailable, measureBottom } from './layoutHarness'
import { decode, imageToolsReady, inkBox, shootHtml } from './outputHarness'

/**
 * Phase 40 - OUTPUT GATE. Every row of the PAPER_ENGINE_RULES §6 matrix goes model -> paper decision -> (measured safety net)
 * -> HTML -> real PDF (headless Chromium, poppler inspection) -> real image (Playwright crop). Plus the gate checklist items
 * that are about the output itself. Electron, a printer and the clipboard are NOT involved (standing gaps).
 * Samples for the owner land in docs/reference/qa/ when QUOT3_QA_DIR is set. Skipped when Chromium/poppler/Playwright are absent.
 */
const tool = (n: string): boolean => spawnSync(n, ['-v']).error === undefined
const ready = chromeAvailable() && imageToolsReady() && tool('pdfinfo') && tool('pdftotext') && tool('pdffonts')
const run = ready ? describe : describe.skip
const root = join(__dirname, '..', '..', '..', '..', 'resources')
const QA = process.env.QUOT3_QA_DIR

const NG = 'non_gst', GST = 'gst'
/** [label, mode, format, rows, extras, forced, expected size, expected pages] - the §6 matrix verbatim. */
type Row = [string, PrintMode, string, number, number, Paper | undefined, Paper, number]
const MATRIX: Row[] = [
  ['rough-ng-40-0', 'rough', NG, 40, 0, undefined, 'A5', 1],
  ['rough-ng-41-0', 'rough', NG, 41, 0, undefined, 'A4', 1],
  ['rough-ng-80-0', 'rough', NG, 80, 0, undefined, 'A4', 1],
  ['rough-ng-81-0', 'rough', NG, 81, 0, undefined, 'A4', 2],
  ['pro-ng-30-0', 'professional', NG, 30, 0, undefined, 'A5', 1],
  ['pro-ng-31-0', 'professional', NG, 31, 0, undefined, 'A4', 1],
  ['pro-ng-70-0', 'professional', NG, 70, 0, undefined, 'A4', 1],
  ['pro-ng-71-0', 'professional', NG, 71, 0, undefined, 'A4', 2],
  ['rough-ng-10-2', 'rough', NG, 10, 2, undefined, 'A5', 1],
  ['rough-ng-10-3', 'rough', NG, 10, 3, undefined, 'A4', 1],
  ['rough-ng-50-3', 'rough', NG, 50, 3, undefined, 'A4', 1],
  ['rough-gst-10-0', 'rough', GST, 10, 0, undefined, 'A5', 1],
  ['rough-gst-10-1', 'rough', GST, 10, 1, undefined, 'A4', 1],
  ['pro-gst-31-0', 'professional', GST, 31, 0, undefined, 'A4', 1],
  ['rough-ng-10-0-forcedA4', 'rough', NG, 10, 0, 'A4', 'A4', 1],
  ['rough-ng-60-0-forcedA5', 'rough', NG, 60, 0, 'A5', 'A5', 2]
]

interface Out { bill: Bill; size: Paper; pages: number; html: string; pdf: string; pdfPages: number; pdfW: number; pdfH: number; pageText: string[]; decision: ReturnType<typeof decideForBill> }

async function build(mode: PrintMode, bill: Bill, forced?: Paper): Promise<Out> {
  let decision = decideForBill(bill, mode, forced ? { forced } : {})
  const render = (d: typeof decision, density = 0): string => renderPrintHtml(buildPrintModel(bill, mode, DEFAULT_PRINT_SETTINGS, d), { fontBaseUrl: printFontBaseUrl(root), density })
  let html = render(decision)
  // the service's measured-overflow safety net (unforced A5 only)
  if (decision.size === 'A5' && !forced) {
    if (isOverflow('A5', measureBottom(html, 'A5'))) { decision = decideForBill(bill, mode, { measuredOverflow: true }); html = render(decision) }
  }
  // Phase 40: a one-page A4 decision is fitted by density tier, exactly as PrintService does
  let density = 0
  if (decision.size === 'A4' && decision.pages === 1) {
    density = (await fitDensity(async (t) => measureBottom(render(decision, t), 'A4'))).tier
    if (density > 0) html = render(decision, density)
  }
  const dir = mkdtempSync(join(tmpdir(), 'q3g-'))
  const f = join(dir, 'p.html'), pdf = join(dir, 'p.pdf')
  writeFileSync(f, html)
  spawnSync(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, 'file://' + f], { encoding: 'utf8' })
  if (!existsSync(pdf)) throw new Error('no pdf')
  const t = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' })
  const pdfPages = Number(/Pages:\s+(\d+)/.exec(t)![1])
  const m = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(t)!
  const pageText = Array.from({ length: pdfPages }, (_, i) => execFileSync('pdftotext', ['-f', String(i + 1), '-l', String(i + 1), '-layout', pdf, '-'], { encoding: 'utf8' }))
  return { bill, size: decision.size, pages: decision.pages, html, pdf, pdfPages, pdfW: Number(m[1]) * 25.4 / 72, pdfH: Number(m[2]) * 25.4 / 72, pageText, decision }
}
const dims = (s: Paper): [number, number] => (s === 'A5' ? [148, 210] : [210, 297])

run('Phase 40 - output gate: the PAPER_ENGINE_RULES §6 matrix through model -> paper -> PDF -> image', () => {
  if (QA) mkdirSync(QA, { recursive: true })
  for (const [label, mode, fmt, rows, extras, forced, size, pages] of MATRIX) {
    it(label, async () => {
      const bill = matrixBill(fmt, rows, extras, fmt === GST)
      const o = await build(mode, bill, forced)
      // paper decision
      expect(o.size, 'decided size').toBe(size)
      expect(o.pages, 'decided pages').toBe(pages)
      // PDF: right sheet, and the real page count equals the engine's
      const [w, h] = dims(size)
      expect(Math.abs(o.pdfW - w), 'pdf width mm').toBeLessThan(1.5)
      expect(Math.abs(o.pdfH - h), 'pdf height mm').toBeLessThan(1.5)
      expect(o.pdfPages, 'real PDF pages vs engine pages').toBe(pages)
      // repeated header on every page, totals only on the last
      o.pageText.forEach((t, i) => expect(t, `header on page ${i + 1}`).toMatch(/Sl\.?\s*No/))
      expect(o.pageText.at(-1), 'total on last page').toMatch(/Total/)
      if (o.pdfPages > 1) expect(o.pageText[0], 'total not on page 1').not.toMatch(/\bTotal\b/)
      // overflow check for forced-A5-with-many-rows is expected to spill onto more pages (cramped warning), never lose rows
      // image: tight crop, one image, margins within padding
      const shot = await shootHtml(o.html, size, QA && ['rough-ng-40-0', 'pro-ng-31-0', 'rough-ng-10-3', 'rough-gst-10-1', 'rough-ng-81-0', 'rough-ng-80-0', 'pro-ng-70-0'].includes(label) ? `image-matrix-${label}` : undefined)
      const png = pngSize(shot.png)!
      expect(png).toEqual({ width: shot.plan.pixelWidth, height: shot.plan.pixelHeight })
      const d = decode(shot.png), box = inkBox(d), pad = IMAGE_PADDING_PX * shot.plan.scale
      expect(box.l).toBeLessThanOrEqual(pad + shot.plan.scale)
      expect(box.t).toBeLessThanOrEqual(pad + shot.plan.scale)
      expect(d.w - 1 - box.r).toBeLessThanOrEqual(pad + shot.plan.scale)
      expect(d.h - 1 - box.b).toBeLessThanOrEqual(pad + shot.plan.scale)
      expect(shot.plan.scale).toBeGreaterThanOrEqual(2)
      if (QA && ['rough-ng-40-0', 'pro-ng-31-0', 'rough-ng-81-0', 'rough-gst-10-1', 'rough-ng-80-0', 'pro-ng-70-0'].includes(label)) copyFileSync(o.pdf, join(QA, `pdf-${label}.pdf`))
    }, 90_000)
  }

  it('measured overflow: a 40-row bill with very long names starts on A5 and ends on A4 (safety net)', async () => {
    const bill = matrixBill(NG, 40, 0)
    bill.rows.forEach((r, i) => { if (i % 2 === 0) r.nameRuns = [{ t: 'Hand woven silk brocade bridal lehenga set with matching dupatta and blouse piece and more words '.repeat(2) }] })
    const o = await build('rough', bill)
    expect(o.decision.size).toBe('A4')
    expect(o.decision.reasons.join(' ')).toMatch(/did not fit A5/)
    expect(o.pdfPages).toBe(1)
  }, 90_000)

  describe('gate checklist - output content', () => {
    it('extra-col warning + ack, GST with extras -> A4 + warning', () => {
      const ng = decideForBill(matrixBill(NG, 10, 3), 'rough')
      expect(ng).toMatchObject({ size: 'A4', requiresAck: true })
      expect(ng.warnings[0]).toMatch(/More than 2 extra columns/)
      const g = decideForBill(matrixBill(GST, 10, 1, true), 'rough')
      expect(g).toMatchObject({ size: 'A4', requiresAck: true })
      expect(g.warnings[0]).toMatch(/GST bills with extra columns print on A4/)
    })
    it('rupee glyph in the PDF text and the font is embedded (rough and professional)', async () => {
      for (const mode of ['rough', 'professional'] as const) {
        const o = await build(mode, printFixture('legacy'))
        expect(o.pageText.join(''), mode).toContain('₹')
        const fonts = execFileSync('pdffonts', [o.pdf], { encoding: 'utf8' }).split('\n').slice(2).filter(Boolean)
        expect(fonts.length).toBeGreaterThan(0)
        for (const l of fonts) expect(l, l).toMatch(/\byes\s+yes\b|\byes\b/)
      }
    })
    it('professional has PO + company block; rough has neither', async () => {
      const p = (await build('professional', printFixture('legacy'))).pageText.join('\n')
      expect(p).toContain('PO No')
      expect(p).toContain('Q3-0007')
      expect(p).toContain('Your Company Name')
      const r = (await build('rough', printFixture('legacy'))).pageText.join('\n')
      expect(r).not.toContain('PO No')
      expect(r).not.toContain('Q3-0007')
      expect(r).not.toContain('Your Company Name')
    })
    it('rough has no party address (and no phone/transport lines); professional does', async () => {
      const r = (await build('rough', printFixture('legacy'))).pageText.join('\n')
      expect(r).toContain('Ruby Traders')
      expect(r).not.toContain('12, Market Road')
      const p = (await build('professional', printFixture('legacy'))).pageText.join('\n')
      expect(p).toContain('12, Market Road')
    })
    it('no overflow in the worst fixtures: nothing leaves the sheet sideways (A4, rough + professional)', async () => {
      for (const id of ['name120', 'header40', 'gstExtra3', 'longText'] as const) for (const mode of ['rough', 'professional'] as const) {
        const o = await build(mode, printFixture(id), 'A4')
        expect(o.pdfW).toBeLessThan(211)
        expect(o.pageText.join('')).toContain('Total')
      }
    }, 120_000)
    it('image: an A4 multi-page bill is one tall image and the ₹ glyph pixels exist in it', async () => {
      const o = await build('rough', matrixBill(NG, 150, 0))
      expect(o.pdfPages).toBeGreaterThan(1)
      const s = await shootHtml(o.html, 'A4')
      expect(s.plan.rect.height).toBeGreaterThan(1123 * 2)
      expect(s.fontOk).toBe(true)
    }, 120_000)
  })
})
