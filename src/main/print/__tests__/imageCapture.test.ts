import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { printFixture, type PrintFixtureId } from '../../../shared/__fixtures__/printBills'
import { simplePaperDecision } from '../../../shared/paper/paperTypes'
import { IMAGE_PADDING_PX, pngSize, verifyScale } from '../../../shared/print/imageFlow'
import { buildPrintModel, DEFAULT_PRINT_SETTINGS } from '../../../shared/print/printModel'
import { renderPrintHtml } from '../../../shared/print/template/renderHtml'
import type { PrintMode } from '../../../shared/types'
import { printFontBaseUrl } from '../template'
import { decode, imageToolsReady, inkBox, isInk, shootHtml } from './outputHarness'

/**
 * Phase 39 - the crop maths on a REAL Chromium screenshot (no Electron): the same CONTENT_RECT_SCRIPT + planCapture the app
 * uses, captured with a device scale factor, then the PNG's pixels are inspected. Skipped when Chromium or Playwright is absent.
 */
const root = join(__dirname, '..', '..', '..', '..', 'resources')
const shoot = (id: PrintFixtureId, paper: 'A5' | 'A4', mode: PrintMode) =>
  shootHtml(renderPrintHtml(buildPrintModel(printFixture(id), mode, DEFAULT_PRINT_SETTINGS, simplePaperDecision(paper)), { fontBaseUrl: printFontBaseUrl(root) }), paper, `image-${id}-${paper}-${mode}`)
const run = imageToolsReady() ? describe : describe.skip

run('Phase 39 - copy-as-image crop on a real Chromium screenshot', () => {
  const CASES: Array<[PrintFixtureId, 'A5' | 'A4', PrintMode]> = [['legacy', 'A5', 'rough'], ['gst', 'A4', 'professional'], ['rows150', 'A4', 'rough']]
  for (const [id, paper, mode] of CASES) {
    it(`${id} ${paper} ${mode}: tight uniform crop, full height, crisp scale, no clipped edge`, async () => {
      const s = await shoot(id, paper, mode)
      const size = pngSize(s.png)!
      expect(size).toEqual({ width: s.plan.pixelWidth, height: s.plan.pixelHeight }) // PNG is exactly the planned pixel size
      const d = decode(s.png)
      const box = inkBox(d)
      const pad = IMAGE_PADDING_PX * s.plan.scale
      // margins around the ink never exceed the padding (+1 CSS px for antialiasing/half-pixel borders), and the ink is not cut at the edge
      expect(box.l, 'left margin').toBeLessThanOrEqual(pad + s.plan.scale)
      expect(box.t, 'top margin').toBeLessThanOrEqual(pad + s.plan.scale)
      expect(d.w - 1 - box.r, 'right margin').toBeLessThanOrEqual(pad + s.plan.scale)
      expect(d.h - 1 - box.b, 'bottom margin').toBeLessThanOrEqual(pad + s.plan.scale)
      // the table border/ink reaches within the padding on every side, so nothing is clipped: right and bottom keep some white
      expect(d.w - 1 - box.r, 'right edge not clipped').toBeGreaterThanOrEqual(pad - 2 * s.plan.scale)
      expect(d.h - 1 - box.b, 'bottom edge not clipped').toBeGreaterThanOrEqual(pad - 2 * s.plan.scale)
      // aspect: image width/height equals the content rectangle's
      expect(Math.abs(d.w / d.h - s.plan.rect.width / s.plan.rect.height)).toBeLessThan(0.001)
      // multi-page bills are ONE tall image: the height covers the whole document content
      expect(s.plan.rect.y + s.plan.rect.height).toBeGreaterThan(0)
      expect(s.plan.rect.height).toBeGreaterThanOrEqual(s.ratioDoc - 2 * IMAGE_PADDING_PX - 80)
      expect(s.plan.scale).toBeGreaterThanOrEqual(2)
      // Phase 72: the device scale factor REALLY applied - the PNG's width is the CSS width x the planned scale (default 4x for a normal bill)
      expect(verifyScale(s.png, s.plan).ok, `png ${size.width}px vs expected ${s.plan.pixelWidth}px`).toBe(true)
    }, 60_000)
  }

  it('rows150 (3 A4 pages) is a single image taller than one page', async () => {
    const s = await shoot('rows150', 'A4', 'rough')
    expect(s.plan.rect.height).toBeGreaterThan(1123 * 2)
    expect(pngSize(s.png)!.height).toBe(s.plan.pixelHeight)
  }, 60_000)

  it('the rupee sign: the bundled font has the glyph and the total cell has ink in the PNG', async () => {
    const s = await shoot('legacy', 'A5', 'professional')
    expect(s.fontOk).toBe(true)
    expect(s.rupee, 'a cell containing the rupee sign').not.toBeNull()
    const d = decode(s.png)
    const r = s.rupee!, k = s.plan.scale
    let ink = 0
    const x0 = Math.max(0, Math.floor((r.x - s.plan.rect.x) * k)), y0 = Math.max(0, Math.floor((r.y - s.plan.rect.y) * k))
    for (let y = y0; y < Math.min(d.h, y0 + Math.ceil(r.h * k)); y++) for (let x = x0; x < Math.min(d.w, x0 + Math.ceil(r.w * k)); x++) if (isInk(d, x, y)) ink++
    expect(ink).toBeGreaterThan(50)
  }, 60_000)
})
