import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { printFixture, type PrintFixtureId } from '../../../shared/__fixtures__/printBills'
import { simplePaperDecision } from '../../../shared/paper/paperTypes'
import { PAPER_MM } from '../../../shared/print/printConstants'
import type { PrintMode } from '../../../shared/types'
import { buildPrintModel, DEFAULT_PRINT_SETTINGS } from '../../../shared/print/printModel'
import { renderPrintHtml } from '../../../shared/print/template/renderHtml'
import { printFontBaseUrl } from '../template'
import { isOverflow } from '../../../shared/print/printFlow'
import { chromeAvailable, measure, measureBottom, pdfPages } from './layoutHarness'
import { join } from 'node:path'

/**
 * Phase 35 - layout measurement in real (headless) Chromium: nothing may exceed the page content box or overflow
 * sideways, wrapped rows grow, tall bills paginate with the header on every page and the totals together on the last.
 * Skipped (not failed) when no Chromium binary exists on the machine.
 */
const run = chromeAvailable() ? describe : describe.skip
const root = join(__dirname, '..', '..', '..', '..', 'resources')
const html = (id: PrintFixtureId, paper: 'A5' | 'A4', mode: PrintMode = 'rough'): string =>
  renderPrintHtml(buildPrintModel(printFixture(id), mode, DEFAULT_PRINT_SETTINGS, simplePaperDecision(paper)), { fontBaseUrl: printFontBaseUrl(root) })

const textPages = (pdf: string, pages: number): string[] =>
  Array.from({ length: pages }, (_, i) => execFileSync('pdftotext', ['-f', String(i + 1), '-l', String(i + 1), '-layout', pdf, '-'], { encoding: 'utf8' }))
const hasPdftotext = ((): boolean => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true } catch { return false } })()

run('Phase 35 - print layout in Chromium', () => {
  const IDS: PrintFixtureId[] = ['legacy', 'gst', 'adjustment', 'extraCols', 'longText', 'styled', 'name60', 'name120', 'header40', 'gstExtra3']
  for (const paper of ['A5', 'A4'] as const) {
    const content = PAPER_MM[paper].w
    for (const mode of ['rough', 'professional'] as const) {
      it(`${paper} ${mode}: no cell or header text leaves the sheet; no horizontal overflow`, () => {
        for (const id of IDS) {
          const m = measure(html(id, paper, mode), content)
          expect(m.over, `${id}`).toEqual([])
          expect(m.docW, `${id} docW`).toBeLessThanOrEqual(m.clientW + 1)
          expect(m.cols.reduce((a, b) => a + b, 0), `${id} cols`).toBeLessThanOrEqual(m.sheetW + 1)
        }
      }, 120_000)
    }
  }
  it('numbers and short headers are never broken: every numeric cell and header fits its column in one piece', () => {
    // GST + 3 extra columns has 10 columns: it cannot be word-clean on A5 (the paper engine, Phase 36, sends it to A4), so A4 only.
    const cases: [PrintFixtureId, 'A5' | 'A4'][] = [['extraCols', 'A5'], ['extraCols', 'A4'], ['adjustment', 'A5'], ['adjustment', 'A4'], ['gst', 'A5'], ['gstExtra3', 'A4']]
    for (const [id, paper] of cases) {
      const m = measure(html(id, paper), PAPER_MM[paper].w)
      expect(m.brokenNumbers, `${id} ${paper}`).toEqual([])
    }
  }, 120_000)
  it('long names wrap and the row grows instead of clipping', () => {
    const short = measure(html('legacy', 'A5'), PAPER_MM.A5.w)
    const long = measure(html('name120', 'A5'), PAPER_MM.A5.w)
    expect(long.maxRowH).toBeGreaterThan(short.minRowH * 2)
  }, 60_000)
  it('A4 fixtures paginate: header repeats on every page and totals sit together on the last page', () => {
    for (const id of ['rows81', 'rows150'] as const) {
      const { pages, file } = pdfPages(html(id, 'A4'))
      expect(pages, id).toBeGreaterThan(1)
      if (!hasPdftotext) continue
      const t = textPages(file, pages)
      t.forEach((p, i) => expect(p, `${id} p${i + 1} header`).toMatch(/Item Name/))
      t.slice(0, -1).forEach((p, i) => expect(p, `${id} p${i + 1} totals`).not.toMatch(/Total/))
      const last = t[t.length - 1] as string
      expect(last).toMatch(/Total/)
      expect(last).toMatch(/item \d+/) // never the totals alone on a page
    }
  }, 120_000)
  it('A5 keeps 40 rough rows plus the footer on one page', () => {
    expect(pdfPages(html('rows40', 'A5')).pages).toBe(1)
  }, 60_000)
  it('Phase 37: the service\'s measurement script + geometry agree with real layout (fits -> no overflow, too tall -> overflow)', () => {
    expect(isOverflow('A5', measureBottom(html('legacy', 'A5'), 'A5'))).toBe(false)
    expect(isOverflow('A5', measureBottom(html('rows40', 'A5'), 'A5'))).toBe(false) // the owner's 40-row A5 rule fits
    expect(isOverflow('A5', measureBottom(html('rows81', 'A5'), 'A5'))).toBe(true) // 81 rows cannot fit one A5 page
    expect(isOverflow('A5', measureBottom(html('name120', 'A5'), 'A5'))).toBe(false)
  }, 120_000)
})
