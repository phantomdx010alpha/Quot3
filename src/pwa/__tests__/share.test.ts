import { describe, expect, it } from 'vitest'
import '../../shared/format'
import { PRINT_FIXTURE_IDS, printFixture } from '../../shared/__fixtures__/printBills'
import { decideForBill } from '../../shared/print/printFlow'
import { PRINT_FONT_FILES } from '../../shared/print/printConstants'
import { IMAGE_PADDING_PX } from '../../shared/print/imageFlow'
import { computePageBreaks, contentPageHeight, contentWidth, layoutFitted, layoutPrintModel, layoutTexts, type Measure } from '../share/layout'
import { buildPdf, jpegSize, pageSizePt, renderLayoutPdf } from '../share/pdf'
import { CANVAS_LIMITS, ensureShareFonts, pickScale, renderLayoutImage, resetShareFontsForTest, ShareError, type CanvasLike, type Ctx2D } from '../share/image'
import { makeShareFile, modelFor, type PhoneCompany, type ShareEnvDeps } from '../share/shareBill'
import { canShareFile, shareFile, shareFileName, type ShareEnv, type ShareNavigator } from '../share/shareSheet'

const measure: Measure = (t, s) => t.length * s.sizePx * 0.5
const strip = (s: string): string => s.replace(/\s+/g, '')
const COMPANY: PhoneCompany = { name: 'Phone Co', phone: '99000 11111', address: '1 High St', logoDataUrl: null }

/** A recording canvas: no pixels, every call kept. `toBlob` returns the given bytes. */
function fakeCanvasFactory(bytes: number[] = [0x89, 0x50, 0x4e, 0x47]): { make: (w: number, h: number) => CanvasLike; made: { w: number; h: number; calls: string[] }[] } {
  const made: { w: number; h: number; calls: string[] }[] = []
  const make = (w: number, h: number): CanvasLike => {
    const rec = { w, h, calls: [] as string[] }
    made.push(rec)
    const ctx = {
      fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textBaseline: '',
      save: () => rec.calls.push('save'), restore: () => rec.calls.push('restore'), scale: () => rec.calls.push('scale'), translate: () => rec.calls.push('translate'),
      fillRect: () => rec.calls.push('fillRect'), beginPath: () => undefined, rect: () => undefined, clip: () => undefined, moveTo: () => undefined, lineTo: () => undefined, stroke: () => rec.calls.push('stroke'),
      fillText: (t: string) => rec.calls.push('text:' + t), drawImage: () => rec.calls.push('drawImage'), measureText: (t: string) => ({ width: t.length * 5 })
    } as unknown as Ctx2D
    return { width: w, height: h, getContext: () => ctx, toBlob: (cb) => cb(new Blob([new Uint8Array(bytes)])) }
  }
  return { make, made }
}

describe('Phase 184 - layout uses the shared print model unchanged', () => {
  it('every fixture, both styles: the paper decision is the shared rule and every printed text is in the layout', () => {
    for (const id of PRINT_FIXTURE_IDS) for (const style of ['rough', 'professional'] as const) {
      const bill = printFixture(id)
      const model = modelFor(bill, style, COMPANY)
      expect(model.paper).toEqual(decideForBill(bill, style))
      const l = layoutPrintModel(model, measure)
      const all = strip(layoutTexts(l).join(''))
      for (const c of model.columns) expect(all).toContain(strip(c.label))
      for (const r of [...model.body, ...model.footer, ...model.tail]) {
        if (r.label) expect(all).toContain(strip(r.label))
        for (const cell of Object.values(r.cells)) expect(all).toContain(strip(cell.text))
      }
      expect(l.rows.filter((r) => r.group === 'body').length).toBe(model.body.length + model.footer.filter((r) => r.label === undefined).length)
      expect(l.rows.filter((r) => r.group === 'foot').length).toBe(model.footer.filter((r) => r.label !== undefined).length)
      expect(l.rows.filter((r) => r.group === 'tail').length).toBe(model.tail.length)
    }
  })

  it('rough has no company block or PO number; professional has the company, PO number and date', () => {
    const bill = printFixture('legacy')
    const rough = strip(layoutTexts(layoutPrintModel(modelFor(bill, 'rough', COMPANY), measure)).join(''))
    expect(rough).not.toContain('PhoneCo')
    expect(rough).not.toContain('Q3-0007')
    expect(rough).toContain('RubyTraders')
    const pro = strip(layoutTexts(layoutPrintModel(modelFor(bill, 'professional', COMPANY), measure)).join(''))
    expect(pro).toContain('PhoneCo')
    expect(pro).toContain('Q3-0007')
    expect(pro).toContain('08Oct2026')
    expect(pro).toContain('QUOTATIONFOR')
  })

  it('the final total carries the rupee sign; adjustments stay in the footer', () => {
    const m = modelFor(printFixture('adjustment'), 'rough', null)
    const texts = layoutTexts(layoutPrintModel(m, measure))
    expect(texts.some((t) => t.startsWith('₹'))).toBe(true)
    expect(m.footer.some((r) => r.kind === 'adjustment')).toBe(true)
  })

  it('bold and red runs are drawn bold / red; an unstyled name is not', () => {
    const l = layoutPrintModel(modelFor(printFixture('styled'), 'rough', null), measure)
    const text = l.ops.filter((o) => o.op === 'text') as Extract<(typeof l.ops)[number], { op: 'text' }>[]
    expect(text.some((o) => o.color === '#c00000')).toBe(true)
    expect(text.some((o) => o.bold && o.color === '#000000')).toBe(true)
  })

  it('long names wrap inside their column: nothing is drawn past the page width', () => {
    const l = layoutPrintModel(modelFor(printFixture('name120'), 'rough', null), measure)
    for (const o of l.ops) if (o.op === 'text') expect(o.x + measure(o.text, { bold: o.bold, sizePx: o.sizePx })).toBeLessThanOrEqual(l.width + 0.5)
  })

  it('the width is the paper width minus both print margins', () => {
    const a5 = modelFor(printFixture('legacy'), 'rough', null)
    expect(a5.paper.size).toBe('A5')
    expect(Math.round(contentWidth(a5))).toBe(Math.round((148 - 12) * 96 / 25.4))
  })
})

describe('Phase 184 - pages', () => {
  it('a short bill is one page; a very long one breaks only at row boundaries and never inside the totals', () => {
    expect(layoutFitted(modelFor(printFixture('legacy'), 'rough', null), measure).pageBreaks).toEqual([])
    const m = modelFor(printFixture('rows150'), 'rough', null)
    const l = layoutFitted(m, measure)
    expect(l.pageBreaks.length).toBeGreaterThan(0)
    const tops = new Set(l.rows.map((r) => r.top))
    for (const b of l.pageBreaks) expect(tops.has(b)).toBe(true)
    const footTop = Math.min(...l.rows.filter((r) => r.group === 'foot').map((r) => r.top))
    for (const b of l.pageBreaks) { const inside = l.rows.some((r) => r.group === 'foot' && r.top < b && b < r.bottom + 0.01 && r.top !== footTop && b !== footTop); expect(inside).toBe(false) }
    const bands = [0, ...l.pageBreaks, l.height]
    for (let i = 0; i + 1 < bands.length; i++) expect(bands[i + 1]! - bands[i]!).toBeLessThanOrEqual(contentPageHeight(m) + 0.5)
  })

  it('computePageBreaks: a block that fits has no break; a row taller than a page does not loop', () => {
    expect(computePageBreaks({ height: 100, rows: [{ group: 'body', top: 0, bottom: 100 }] }, 200)).toEqual([])
    expect(computePageBreaks({ height: 500, rows: [{ group: 'body', top: 0, bottom: 500 }] }, 200)).toEqual([500])
  })

  it('an A4 bill that the rules put on ONE page is fitted by the density tiers (as on desktop)', () => {
    const m = modelFor(printFixture('rows81'), 'rough', null)
    if (m.paper.size === 'A4' && m.paper.pages === 1) expect(layoutFitted(m, measure).tier).toBeGreaterThanOrEqual(0)
    expect(m.paper).toEqual(decideForBill(printFixture('rows81'), 'rough'))
  })
})

describe('Phase 184 - image', () => {
  it('draws on a white page with the shared padding on every side and exports a PNG', async () => {
    const l = layoutFitted(modelFor(printFixture('legacy'), 'rough', null), measure)
    const { make, made } = fakeCanvasFactory()
    const img = await renderLayoutImage(l, make)
    expect(img.scale).toBe(3)
    expect(img.width).toBe(Math.ceil((l.width + 2 * IMAGE_PADDING_PX) * 3))
    expect(img.height).toBe(Math.ceil((l.height + 2 * IMAGE_PADDING_PX) * 3))
    expect(Array.from(img.bytes)).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(made[0]!.calls.some((c) => c === 'text:₹' || c.startsWith('text:₹'))).toBe(true)
  })

  it('trims a capture whose content is small inside a big white surface (imageTrim rule)', async () => {
    const l = layoutFitted(modelFor(printFixture('legacy'), 'rough', null), measure)
    const { make, made } = fakeCanvasFactory()
    const wrapped = (w: number, h: number): CanvasLike => {
      const c = make(w, h)
      if (w < 100) return c
      const ctx = c.getContext('2d')!
      ctx.getImageData = () => { const d = new Uint8ClampedArray(w * h * 4).fill(255); for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) { const i = (y * w + x) * 4; d[i] = 0; d[i + 1] = 0; d[i + 2] = 0 } return { data: d } }
      return c
    }
    const img = await renderLayoutImage(l, wrapped)
    expect(made.length).toBe(2)
    expect(img.width).toBeLessThan(Math.ceil((l.width + 2 * IMAGE_PADDING_PX) * 3))
  })

  it('steps the scale down for a tall bill and refuses one that cannot fit', () => {
    expect(pickScale(500, 1000)).toBe(3)
    expect(pickScale(500, CANVAS_LIMITS.maxSide / 2.5)).toBe(2)
    expect(() => pickScale(500, 20000)).toThrow(ShareError)
  })

  it('fonts: the four bundled files load once; a failure resolves false and can retry', async () => {
    resetShareFontsForTest()
    const added: unknown[] = []
    const ok = await ensureShareFonts('/fonts/', { create: (f, u) => ({ load: async () => ({ f, u }) }), add: (x) => added.push(x) })
    expect(ok).toBe(true)
    expect(added).toHaveLength(PRINT_FONT_FILES.length)
    expect(await ensureShareFonts('/fonts', { create: () => { throw new Error('x') }, add: () => undefined })).toBe(true)
    resetShareFontsForTest()
    expect(await ensureShareFonts('/fonts', { create: () => ({ load: async () => { throw new Error('404') } }), add: () => undefined })).toBe(false)
    expect(await ensureShareFonts('/fonts', { create: () => ({ load: async () => ({}) }), add: () => undefined })).toBe(true)
    resetShareFontsForTest()
  })
})

/** Smallest thing jpegSize accepts: SOI, a SOF0 marker for 40 x 30, EOI. */
const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x1e, 0x00, 0x28, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9])

describe('Phase 184 - PDF', () => {
  it('reads a JPEG size and refuses non-JPEG bytes', () => {
    expect(jpegSize(FAKE_JPEG)).toEqual({ width: 40, height: 30 })
    expect(jpegSize(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull()
  })

  it('writes a structurally valid PDF: header, xref offsets point at the objects, one page per picture, A5 / A4 media box', () => {
    for (const paper of ['A5', 'A4'] as const) {
      const pdf = buildPdf(paper, [{ jpeg: FAKE_JPEG, widthPx: 40, heightPx: 30, widthPt: 300, heightPt: 200 }, { jpeg: FAKE_JPEG, widthPx: 40, heightPx: 30, widthPt: 300, heightPt: 200 }], 'PO (1)')
      const text = new TextDecoder('latin1').decode(pdf)
      expect(text.startsWith('%PDF-1.4')).toBe(true)
      expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
      expect(text).toContain('/Count 2')
      const { w, h } = pageSizePt(paper)
      expect(text).toContain(`/MediaBox [0 0 ${Math.round(w * 100) / 100} ${Math.round(h * 100) / 100}]`)
      const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1])
      expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref')
      const entries = [...text.slice(xrefAt).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]))
      expect(entries).toHaveLength(3 + 2 * 3)
      entries.forEach((off, i) => expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`))
      expect(text).toContain('/Filter /DCTDecode')
      expect(text).not.toContain('(PO (1))')
    }
    expect(() => buildPdf('A5', [])).toThrow(ShareError)
  })

  it('a picture is shrunk to the printable area, never enlarged', () => {
    const pdf = new TextDecoder('latin1').decode(buildPdf('A5', [{ jpeg: FAKE_JPEG, widthPx: 40, heightPx: 30, widthPt: 100, heightPt: 50 }]))
    expect(pdf).toMatch(/q 100 0 0 50 /)
    const big = new TextDecoder('latin1').decode(buildPdf('A5', [{ jpeg: FAKE_JPEG, widthPx: 40, heightPx: 30, widthPt: 2000, heightPt: 100 }]))
    const m = /q ([\d.]+) 0 0 ([\d.]+) /.exec(big)!
    expect(Number(m[1])).toBeLessThan(420 - 2 * 17)
  })

  it('renders one JPEG per page band', async () => {
    const m = modelFor(printFixture('rows150'), 'rough', null)
    const l = layoutFitted(m, measure)
    const { make } = fakeCanvasFactory(Array.from(FAKE_JPEG))
    const r = await renderLayoutPdf(l, m.paper.size, make)
    expect(r.pages).toBe(l.pageBreaks.length + 1)
    expect(new TextDecoder('latin1').decode(r.bytes)).toContain(`/Count ${r.pages}`)
  })
})

describe('Phase 184 - share sheet', () => {
  const file = (name: string): File => new File([new Uint8Array([1])], name)
  function env(nav: ShareNavigator | undefined): { env: ShareEnv; downloads: string[] } {
    const downloads: string[] = []
    return { env: { nav, makeFile: (b, n, m) => new File([b as BlobPart], n, { type: m }), download: (f) => downloads.push(f.name) }, downloads }
  }
  const bytes = new Uint8Array([1, 2, 3])

  it('shares the file through the system sheet when it can', async () => {
    const seen: File[][] = []
    const { env: e, downloads } = env({ canShare: () => true, share: async (d) => { seen.push(d.files ?? []) } })
    expect(await shareFile(e, bytes, 'a.png', 'image/png', 'T')).toEqual({ outcome: 'shared', fileName: 'a.png' })
    expect(seen[0]![0]!.name).toBe('a.png')
    expect(downloads).toEqual([])
  })
  it('closing the sheet is cancelled, not an error and not a download', async () => {
    const { env: e, downloads } = env({ canShare: () => true, share: async () => { throw new DOMException('x', 'AbortError') } })
    expect((await shareFile(e, bytes, 'a.png', 'image/png', 'T')).outcome).toBe('cancelled')
    expect(downloads).toEqual([])
  })
  it('falls back to a download when sharing is blocked, cannot take files, or does not exist', async () => {
    const blocked = env({ canShare: () => true, share: async () => { throw new DOMException('x', 'NotAllowedError') } })
    expect((await shareFile(blocked.env, bytes, 'b.pdf', 'application/pdf', 'T')).outcome).toBe('downloaded')
    const noFiles = env({ canShare: () => false, share: async () => undefined })
    expect((await shareFile(noFiles.env, bytes, 'c.pdf', 'application/pdf', 'T')).outcome).toBe('downloaded')
    const none = env(undefined)
    expect((await shareFile(none.env, bytes, 'd.png', 'image/png', 'T')).outcome).toBe('downloaded')
    const throwing = env({ canShare: () => { throw new Error('x') }, share: async () => undefined })
    expect(canShareFile(throwing.env, file('e'))).toBe(false)
    expect([blocked.downloads, noFiles.downloads, none.downloads]).toEqual([['b.pdf'], ['c.pdf'], ['d.png']])
  })
  it('file names are safe and never empty', () => {
    expect(shareFileName('PH-0001', 'Ruby Traders & Co.', 'png')).toBe('Quotation-PH-0001-Ruby-Traders-Co.png')
    expect(shareFileName('', '', 'pdf')).toBe('Quotation.pdf')
    expect(shareFileName('A/B', '../../x', 'pdf')).not.toMatch(/[/\\]/)
    expect(shareFileName('1', 'x'.repeat(200), 'pdf').length).toBeLessThan(80)
  })
})

describe('Phase 184 - bill to file', () => {
  const deps = (canvas: ReturnType<typeof fakeCanvasFactory>): ShareEnvDeps => ({ canvas: canvas.make, fonts: async () => true, loadLogo: async () => null })
  it('makes a PNG or a PDF with the right names, type and paper; the bill object is not changed', async () => {
    const bill = printFixture('legacy')
    const before = JSON.stringify(bill)
    const png = await makeShareFile(bill, { style: 'professional', kind: 'image' }, COMPANY, deps(fakeCanvasFactory()))
    expect(png).toMatchObject({ mime: 'image/png', fileName: 'Quotation-Q3-0007-Ruby-Traders.png', pages: 1, paper: 'A5' })
    const pdf = await makeShareFile(bill, { style: 'rough', kind: 'pdf' }, null, deps(fakeCanvasFactory(Array.from(FAKE_JPEG))))
    expect(pdf).toMatchObject({ mime: 'application/pdf', fileName: 'Quotation-Q3-0007-Ruby-Traders.pdf', pages: 1 })
    expect(JSON.stringify(bill)).toBe(before)
  })
  it('a logo that cannot load is left out; a non-embedded logo address is never fetched', async () => {
    const c = fakeCanvasFactory()
    let asked = 0
    const d: ShareEnvDeps = { canvas: c.make, fonts: async () => true, loadLogo: async () => { asked++; return null } }
    await makeShareFile(printFixture('legacy'), { style: 'professional', kind: 'image' }, { ...COMPANY, logoDataUrl: 'https://example.com/x.png' }, d)
    expect(asked).toBe(0)
    await makeShareFile(printFixture('legacy'), { style: 'professional', kind: 'image' }, { ...COMPANY, logoDataUrl: 'data:image/png;base64,AAAA' }, d)
    expect(asked).toBe(1)
  })
})
