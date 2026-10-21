/**
 * Phase 184 - phone share, step 3: the PDF. Decision of Phase 173 (provisional until the owner reports): a PDF whose pages hold
 * the same high-resolution picture as the share image (JPEG, white background), written by this small built-in writer. No PDF library,
 * the rupee sign cannot go missing, the file stays small. Text in the PDF is NOT selectable (owner to confirm that is fine).
 * Page size comes from the paper decision (A5 / A4 in mm from `printConstants.ts`); content sits inside the print margins.
 */
import { PAGE_MARGIN_MM, PAPER_MM } from '../../shared/print/printConstants'
import type { Paper } from '../../shared/types'
import { blobBytes, canvasBlob, drawLayout, pickScale, ShareError, type CanvasFactory } from './image'
import { SHARE_COLORS, type ShareLayout } from './layout'

const PT_PER_MM = 72 / 25.4
export const pageSizePt = (p: Paper): { w: number; h: number } => ({ w: PAPER_MM[p].w * PT_PER_MM, h: PAPER_MM[p].h * PT_PER_MM })

export interface PdfPageImage {
  /** JPEG bytes (baseline, 3 components). */
  jpeg: Uint8Array
  widthPx: number
  heightPx: number
  /** Printed size of the picture in pt (1 layout px = 0.75 pt). */
  widthPt: number
  heightPt: number
}

const enc = new TextEncoder()
const num = (n: number): string => (Math.round(n * 100) / 100).toString()

/** JPEG pixel size from its SOF marker; null when the bytes are not a JPEG. */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const m = b[i + 1] as number
    if (m === 0xff) { i++; continue }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: ((b[i + 5] as number) << 8) | (b[i + 6] as number), width: ((b[i + 7] as number) << 8) | (b[i + 8] as number) }
    i += 2 + (((b[i + 2] as number) << 8) | (b[i + 3] as number))
  }
  return null
}

/**
 * A valid PDF 1.4 with one page per image: each picture is placed at the top-left inside the paper's print margin and is shrunk (never enlarged)
 * to fit the page's printable width and height.
 */
export function buildPdf(paper: Paper, pages: readonly PdfPageImage[], title = 'Quotation'): Uint8Array {
  if (pages.length === 0) throw new ShareError('ENCODE_FAILED', 'Nothing to put in the PDF.')
  const { w: pw, h: ph } = pageSizePt(paper)
  const margin = PAGE_MARGIN_MM[paper] * PT_PER_MM
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let size = 0
  const put = (b: Uint8Array | string): void => { const u = typeof b === 'string' ? enc.encode(b) : b; chunks.push(u); size += u.length }
  const obj = (n: number, body: () => void): void => { offsets[n] = size; put(`${n} 0 obj\n`); body(); put('\nendobj\n') }

  // Object numbers: 1 catalog, 2 pages, 3 info, then per page: page, content, image.
  put('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')
  obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'))
  const kids = pages.map((_, i) => `${4 + i * 3} 0 R`).join(' ')
  obj(2, () => put(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`))
  const safeTitle = title.replace(/[^\x20-\x7e]/g, '?').replace(/[()\\]/g, ' ')
  obj(3, () => put(`<< /Title (${safeTitle}) /Producer (Quot3 phone) >>`))

  pages.forEach((p, i) => {
    const pageN = 4 + i * 3, contentN = pageN + 1, imageN = pageN + 2
    const maxW = pw - 2 * margin, maxH = ph - 2 * margin
    const k = Math.min(1, maxW / p.widthPt, maxH / p.heightPt)
    const w = p.widthPt * k, h = p.heightPt * k
    const x = margin, y = ph - margin - h
    const stream = `q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm /Im0 Do Q`
    obj(pageN, () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pw)} ${num(ph)}] /Resources << /XObject << /Im0 ${imageN} 0 R >> >> /Contents ${contentN} 0 R >>`))
    obj(contentN, () => put(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`))
    obj(imageN, () => {
      put(`<< /Type /XObject /Subtype /Image /Width ${p.widthPx} /Height ${p.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`)
      put(p.jpeg)
      put('\nendstream')
    })
  })

  const count = 4 + pages.length * 3
  const xref = size
  put(`xref\n0 ${count}\n0000000000 65535 f \n`)
  for (let n = 1; n < count; n++) put(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  put(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}

export interface RenderedPdf { bytes: Uint8Array; pages: number; scale: number }

/** JPEG quality of the PDF pictures: sharp text, small file. */
export const PDF_JPEG_QUALITY = 0.9

/** Renders each page band of the layout (split at `layout.pageBreaks`) to a JPEG and writes the PDF. */
export async function renderLayoutPdf(l: ShareLayout, paper: Paper, make: CanvasFactory, images: ReadonlyMap<string, unknown> = new Map(), title = 'Quotation', want = 3): Promise<RenderedPdf> {
  const starts = [0, ...l.pageBreaks]
  const bands = starts.map((top, i) => ({ top, bottom: starts[i + 1] ?? l.height }))
  const tallest = bands.reduce((a, b) => Math.max(a, b.bottom - b.top), 1)
  const scale = pickScale(l.width, tallest, want)
  const pages: PdfPageImage[] = []
  for (const band of bands) {
    const hCss = Math.max(band.bottom - band.top, 1)
    const canvas = make(Math.ceil(l.width * scale), Math.ceil(hCss * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ShareError('NO_CANVAS', 'This browser cannot draw the picture.')
    ctx.fillStyle = SHARE_COLORS.paper
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    drawLayout(ctx, l, { scale, originX: 0, originY: 0, top: band.top, bottom: band.bottom }, images)
    const bytes = await blobBytes(await canvasBlob(canvas, 'image/jpeg', PDF_JPEG_QUALITY))
    const real = jpegSize(bytes)
    pages.push({ jpeg: bytes, widthPx: real?.width ?? canvas.width, heightPx: real?.height ?? canvas.height, widthPt: l.width * 0.75, heightPt: hCss * 0.75 })
  }
  return { bytes: buildPdf(paper, pages, title), pages: pages.length, scale }
}
