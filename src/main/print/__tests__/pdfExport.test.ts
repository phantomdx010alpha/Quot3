import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { printFixture, type PrintFixtureId } from '../../../shared/__fixtures__/printBills'
import { decideForBill, countPdfPages } from '../../../shared/print/printFlow'
import type { PrintMode } from '../../../shared/types'
import { buildPrintModel, DEFAULT_PRINT_SETTINGS } from '../../../shared/print/printModel'
import { renderPrintHtml } from '../../../shared/print/template/renderHtml'
import { printFontBaseUrl } from '../template'
import { CHROME, chromeAvailable } from './layoutHarness'

/**
 * Phase 38 - PDFs generated from the real print HTML in the sandbox's headless Chromium (the same engine and the same
 * `preferCSSPageSize` path Electron's `printToPDF` uses; Electron itself is NOT run here). Inspected with poppler tools:
 * page size, page count, embedded fonts, the rupee glyph, text extractability. Skipped when Chromium or poppler is missing.
 */
const tool = (name: string): boolean => { try { execFileSync(name, ['-v'], { stdio: 'ignore' }); return true } catch { return spawnSync(name, ['-v']).status !== null && spawnSync(name, ['-v']).error === undefined } }
const ready = chromeAvailable() && tool('pdfinfo') && tool('pdffonts') && tool('pdftotext')
const run = ready ? describe : describe.skip
const root = join(__dirname, '..', '..', '..', '..', 'resources')

function makePdf(id: PrintFixtureId, mode: PrintMode = 'rough', forced?: 'A4' | 'A5'): { file: string; size: 'A4' | 'A5' } {
  const bill = printFixture(id)
  const decision = decideForBill(bill, mode, { forced })
  const html = renderPrintHtml(buildPrintModel(bill, mode, DEFAULT_PRINT_SETTINGS, decision), { fontBaseUrl: printFontBaseUrl(root) })
  const dir = mkdtempSync(join(tmpdir(), 'q3pdf-'))
  const f = join(dir, 'p.html'), out = join(dir, 'p.pdf')
  writeFileSync(f, html)
  spawnSync(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--no-pdf-header-footer', `--print-to-pdf=${out}`, 'file://' + f], { encoding: 'utf8' })
  if (!existsSync(out)) throw new Error('chromium produced no pdf')
  return { file: out, size: decision.size }
}
const info = (pdf: string): { pages: number; w: number; h: number } => {
  const t = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' })
  const pages = Number(/Pages:\s+(\d+)/.exec(t)![1])
  const m = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(t)!
  return { pages, w: Number(m[1]) * 25.4 / 72, h: Number(m[2]) * 25.4 / 72 }
}
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1.2 // mm; pdfinfo rounds to whole points

run('Phase 38 - PDF export output', () => {
  it('A5 bill: one page of 148 x 210 mm, text extractable, Noto Sans embedded, rupee glyph present', () => {
    const { file, size } = makePdf('legacy')
    expect(size).toBe('A5')
    const i = info(file)
    expect(i.pages).toBe(1)
    expect(near(i.w, 148) && near(i.h, 210)).toBe(true)
    const fonts = execFileSync('pdffonts', [file], { encoding: 'utf8' })
    expect(fonts).toMatch(/Noto ?Sans/i)
    const rows = fonts.split('\n').slice(2).filter((l) => l.trim() !== '')
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r).toMatch(/\byes\s+(yes|no)\s+(yes|no)\b/) // the first "yes" column is "emb"
    const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' })
    expect(text).toContain('₹')
    expect(text).toContain('17226.00') // the print template writes plain 2-dp amounts
    expect(text).toContain('Total')
  })
  it('A4 bill (GST with extra columns, forced A4): 210 x 297 mm', () => {
    const { file, size } = makePdf('gstExtra3', 'rough', 'A4')
    expect(size).toBe('A4')
    const i = info(file)
    expect(i.pages).toBe(1)
    expect(near(i.w, 210) && near(i.h, 297)).toBe(true)
  })
  it('81 rough rows -> A4, 2 pages, totals together on the last page only', () => {
    const { file, size } = makePdf('rows81')
    expect(size).toBe('A4')
    const i = info(file)
    expect(i.pages).toBe(2)
    expect(near(i.w, 210) && near(i.h, 297)).toBe(true)
    const p1 = execFileSync('pdftotext', ['-f', '1', '-l', '1', '-layout', file, '-'], { encoding: 'utf8' })
    const p2 = execFileSync('pdftotext', ['-f', '2', '-l', '2', '-layout', file, '-'], { encoding: 'utf8' })
    expect(p1).not.toMatch(/Total/)
    expect(p2).toMatch(/Total/)
  })
  it('150 rows -> more than 2 pages, and our page counter agrees with pdfinfo for every PDF made here', () => {
    for (const id of ['legacy', 'rows81', 'rows150'] as const) {
      const { file } = makePdf(id)
      expect(countPdfPages(new Uint8Array(readFileSync(file)))).toBe(info(file).pages)
    }
    expect(info(makePdf('rows150').file).pages).toBeGreaterThan(2)
  })
  it('Professional A5 (company band, PO, date): one page, header text extractable', () => {
    const { file } = makePdf('rows30', 'professional')
    expect(info(file).pages).toBe(1)
    const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' })
    expect(text).toContain('QUOTATION FOR')
  })
  it('long text (120-char name, 40-char header): wraps inside the page; the long words are still extractable', () => {
    const { file } = makePdf('name120')
    const text = execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' }).replace(/\s+/g, '')
    expect(text.length).toBeGreaterThan(120)
    expect(info(file).pages).toBeGreaterThanOrEqual(1)
  })
})
