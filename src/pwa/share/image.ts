/**
 * Phase 184 - phone share, step 2: draw a `ShareLayout` onto a canvas and export it. The canvas is injected (`CanvasLike`), so
 * tests run with a recording fake; the browser build uses `browserCanvas`. No Electron, no DOM-to-image capture, no print.
 * Fonts: the bundled Noto Sans files (Latin + Latin-ext, which holds the rupee sign U+20B9) are loaded from `/fonts/`.
 */
import { IMAGE_PADDING_PX, IMAGE_SCALE_RANGE, imageScalesFor } from '../../shared/print/imageFlow'
import { isTight, nonWhiteBounds, trimRect } from '../../shared/print/imageTrim'
import { PRINT_FONT_FAMILY, PRINT_FONT_FILES } from '../../shared/print/printConstants'
import { ASCENT, SHARE_COLORS, type DrawOp, type Measure, type ShareLayout } from './layout'

export interface Ctx2D {
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  font: string
  textBaseline: string
  save(): void
  restore(): void
  scale(x: number, y: number): void
  translate(x: number, y: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  beginPath(): void
  rect(x: number, y: number, w: number, h: number): void
  clip(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  stroke(): void
  fillText(text: string, x: number, y: number): void
  drawImage(img: unknown, ...args: number[]): void
  measureText(text: string): { width: number }
  getImageData?(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray }
}
export interface CanvasLike {
  width: number
  height: number
  getContext(kind: '2d'): Ctx2D | null
  toBlob(cb: (b: Blob | null) => void, type?: string, quality?: number): void
}
export type CanvasFactory = (w: number, h: number) => CanvasLike

export const browserCanvas: CanvasFactory = (w, h) => {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  return c as unknown as CanvasLike
}

/** A phone browser refuses very large canvases (height about 16 k px, area about 16 M px on many Android builds): stay under both. */
export const CANVAS_LIMITS = { maxSide: 16000, maxArea: 100_000_000 } as const
/** The phone's default image scale: 3 (136 mm of A5 -> about 1.5 k px wide: sharp in WhatsApp, small file). The range and step-down rule are the desktop's. */
export const PHONE_IMAGE_SCALE = 3

export class ShareError extends Error {
  constructor(readonly code: 'TOO_LARGE' | 'NO_CANVAS' | 'ENCODE_FAILED', message: string) { super(message); this.name = 'ShareError' }
}

export const fontCss = (bold: boolean, sizePx: number): string => `${bold ? 700 : 400} ${sizePx}px '${PRINT_FONT_FAMILY}', 'Noto Sans', 'Segoe UI', Arial, sans-serif`

/** Text width through a canvas context: what the layout measures with. */
export function canvasMeasure(ctx: Ctx2D): Measure {
  return (text, style) => { ctx.font = fontCss(style.bold, style.sizePx); return ctx.measureText(text).width }
}

export interface DrawWindow { scale: number; /** Layout offset of the top-left corner of the drawing, px (e.g. the image padding). */ originX: number; originY: number; /** Only ops touching [top, bottom) of the layout are drawn; the layout is shifted up by `top`. */ top: number; bottom: number }

/** Draws the layout window. Every colour is a print colour (never themed). `images` maps a logo `src` to a loaded image. */
export function drawLayout(ctx: Ctx2D, l: ShareLayout, win: DrawWindow, images: ReadonlyMap<string, unknown> = new Map()): void {
  ctx.save()
  ctx.scale(win.scale, win.scale)
  ctx.translate(win.originX, win.originY - win.top)
  ctx.beginPath(); ctx.rect(-1, win.top, l.width + 2, win.bottom - win.top); ctx.clip()
  ctx.textBaseline = 'alphabetic'
  const pad = 4
  for (const op of l.ops) {
    if (!touches(op, win.top - pad, win.bottom + pad)) continue
    drawOp(ctx, op, images)
  }
  ctx.restore()
}

function touches(op: DrawOp, top: number, bottom: number): boolean {
  if (op.op === 'line') return Math.max(op.y1, op.y2) >= top && Math.min(op.y1, op.y2) <= bottom
  return op.y + op.h >= top && op.y <= bottom
}

function drawOp(ctx: Ctx2D, op: DrawOp, images: ReadonlyMap<string, unknown>): void {
  switch (op.op) {
    case 'rect': ctx.fillStyle = op.fill; ctx.fillRect(op.x, op.y, op.w, op.h); break
    case 'line': ctx.strokeStyle = op.color; ctx.lineWidth = op.width; ctx.beginPath(); ctx.moveTo(op.x1, op.y1); ctx.lineTo(op.x2, op.y2); ctx.stroke(); break
    case 'text': ctx.fillStyle = op.color; ctx.font = fontCss(op.bold, op.sizePx); ctx.fillText(op.text, op.x, op.y + op.sizePx * ASCENT); break
    case 'image': { const img = images.get(op.src); if (img) ctx.drawImage(img, op.x, op.y, op.w, op.h); break }
  }
}

/** Pick the largest wanted scale whose canvas is within the phone limits, stepping down as the desktop does. */
export function pickScale(widthPx: number, heightPx: number, want = PHONE_IMAGE_SCALE): number {
  for (const s of imageScalesFor(Math.min(want, IMAGE_SCALE_RANGE.max))) {
    const w = Math.ceil(widthPx * s), h = Math.ceil(heightPx * s)
    if (w <= CANVAS_LIMITS.maxSide && h <= CANVAS_LIMITS.maxSide && w * h <= CANVAS_LIMITS.maxArea) return s
  }
  throw new ShareError('TOO_LARGE', 'This bill is too long to share as one image. Share it as a PDF instead.')
}

export function blobBytes(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((b) => new Uint8Array(b))
}
export function canvasBlob(c: CanvasLike, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new ShareError('ENCODE_FAILED', 'The picture could not be made.'))), type, quality))
}

export interface RenderedImage { bytes: Uint8Array; width: number; height: number; scale: number }

/**
 * The share image: the layout plus the same padding on all four sides (the desktop's IMAGE_PADDING_PX), white background, PNG.
 * After drawing, the existing `imageTrim` rule runs as a safety net: if the content does not fill the image it is cropped to content + padding.
 */
export async function renderLayoutImage(l: ShareLayout, make: CanvasFactory, images: ReadonlyMap<string, unknown> = new Map(), want = PHONE_IMAGE_SCALE): Promise<RenderedImage> {
  const cssW = l.width + 2 * IMAGE_PADDING_PX, cssH = l.height + 2 * IMAGE_PADDING_PX
  const scale = pickScale(cssW, cssH, want)
  let canvas = make(Math.ceil(cssW * scale), Math.ceil(cssH * scale))
  let ctx = canvas.getContext('2d')
  if (!ctx) throw new ShareError('NO_CANVAS', 'This browser cannot draw the picture.')
  ctx.fillStyle = SHARE_COLORS.paper
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  drawLayout(ctx, l, { scale, originX: IMAGE_PADDING_PX, originY: IMAGE_PADDING_PX, top: 0, bottom: l.height }, images)

  if (ctx.getImageData) {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const bounds = nonWhiteBounds(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), canvas.width, canvas.height)
    if (bounds && !isTight(bounds, canvas.width, canvas.height)) {
      const r = trimRect(bounds, canvas.width, canvas.height, Math.round(IMAGE_PADDING_PX * scale))
      const out = make(r.width, r.height)
      const octx = out.getContext('2d')
      if (octx) { octx.fillStyle = SHARE_COLORS.paper; octx.fillRect(0, 0, r.width, r.height); octx.drawImage(canvas, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height); canvas = out; ctx = octx }
    }
  }
  const blob = await canvasBlob(canvas, 'image/png')
  return { bytes: await blobBytes(blob), width: canvas.width, height: canvas.height, scale }
}

// ---------- fonts ----------
export interface FontEnv {
  add(face: unknown): void
  create(family: string, url: string, weight: string, unicodeRange: string): { load(): Promise<unknown> }
}
const browserFontEnv = (): FontEnv => ({
  add: (f) => { (document as unknown as { fonts: { add(x: unknown): void } }).fonts.add(f) },
  create: (family, url, weight, unicodeRange) => new FontFace(family, `url(${url}) format('woff2')`, { weight, unicodeRange, style: 'normal' })
})

let fontsReady: Promise<boolean> | null = null
/** Loads the four bundled font files once. Resolves false (never throws) when one cannot load: the system font then draws, and the rupee sign may differ. */
export function ensureShareFonts(baseUrl = '/fonts', env: FontEnv = browserFontEnv()): Promise<boolean> {
  if (fontsReady) return fontsReady
  fontsReady = Promise.all(PRINT_FONT_FILES.map(async (f) => {
    const face = env.create(PRINT_FONT_FAMILY, `${baseUrl.replace(/\/+$/, '')}/${f.file}`, String(f.weight), f.unicodeRange)
    await face.load()
    env.add(face)
  })).then(() => true, () => { fontsReady = null; return false })
  return fontsReady
}
/** Tests only. */
export const resetShareFontsForTest = (): void => { fontsReady = null }
