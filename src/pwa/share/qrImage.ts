/**
 * Phase 298 (planned as Phase 282) - Payments D: the QR matrix and the branded QR picture, on the phone, offline.
 * `qrModel(url)` = the dark modules (library `qrcode-generator`, bundled, MIT; error correction H like the owner's original page).
 * `composeQrImage(...)` = its own PNG on the existing share canvas plumbing (`image.ts`): optional company logo, optional bill line,
 * payee name, bank label, the QR with a quiet zone, the amount line. Names wrap, nothing is cut. It carries NO account number and NO IFSC
 * (10t): the caller passes only labels. No network: the logo is a data URL from the stored company profile.
 */
import qrcode from 'qrcode-generator'
import type { QrImageInput, QrPort } from '../ui/kit/paymentsModel'
import { blobBytes, browserCanvas, canvasBlob, ensureShareFonts, fontCss, pickScale, ShareError, type CanvasFactory, type Ctx2D } from './image'
import { SHARE_COLORS } from './layout'

/** The dark modules of `url` (rows of booleans), or null when it cannot be encoded. */
export function qrModel(url: string): boolean[][] | null {
  if (typeof url !== 'string' || url === '') return null
  try {
    const q = qrcode(0, 'H')
    q.addData(url)
    q.make()
    const n = q.getModuleCount()
    const rows: boolean[][] = []
    for (let r = 0; r < n; r++) { const row: boolean[] = []; for (let c = 0; c < n; c++) row.push(q.isDark(r, c)); rows.push(row) }
    return rows
  } catch { return null }
}

export const QR_IMAGE = { width: 360, pad: 24, qrSide: 288, quietModules: 4, logoMaxH: 56, logoMaxW: 200, gap: 10 } as const

export type QrOp =
  | { op: 'text'; text: string; x: number; y: number; bold: boolean; sizePx: number; color: string }
  | { op: 'modules'; x: number; y: number; cell: number; matrix: boolean[][] }
  | { op: 'logo'; x: number; y: number; w: number; h: number }
export interface QrLayout { width: number; height: number; ops: QrOp[] }
export type MeasureText = (text: string, bold: boolean, sizePx: number) => number

/** Break `text` into lines no wider than `maxW` (a single too-long word is split by characters, never cut off). */
export function wrapText(text: string, maxW: number, measure: (s: string) => number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter((w) => w !== '')) {
      const next = line === '' ? word : `${line} ${word}`
      if (measure(next) <= maxW) { line = next; continue }
      if (line !== '') { out.push(line); line = '' }
      let rest = word
      while (measure(rest) > maxW && rest.length > 1) {
        let k = rest.length - 1
        while (k > 1 && measure(rest.slice(0, k)) > maxW) k--
        out.push(rest.slice(0, k)); rest = rest.slice(k)
      }
      line = rest
    }
    out.push(line)
  }
  return out
}

/** Pure layout (CSS px): everything the picture draws, top to bottom. `logo` = natural size of the logo, or null for text only. */
export function layoutQrImage(input: QrImageInput, matrix: boolean[][], measure: MeasureText, logo: { w: number; h: number } | null): QrLayout {
  const W = QR_IMAGE.width, inner = W - 2 * QR_IMAGE.pad
  const ops: QrOp[] = []
  let y = QR_IMAGE.pad
  const centred = (text: string, bold: boolean, sizePx: number, color: string): void => {
    for (const line of wrapText(text, inner, (s) => measure(s, bold, sizePx))) {
      const lh = Math.round(sizePx * 1.3)
      ops.push({ op: 'text', text: line, x: (W - measure(line, bold, sizePx)) / 2, y, bold, sizePx, color })
      y += lh
    }
    y += QR_IMAGE.gap / 2
  }
  if (logo && logo.w > 0 && logo.h > 0) {
    const k = Math.min(QR_IMAGE.logoMaxW / logo.w, QR_IMAGE.logoMaxH / logo.h, 1)
    const w = Math.round(logo.w * k), h = Math.round(logo.h * k)
    ops.push({ op: 'logo', x: Math.round((W - w) / 2), y, w, h })
    y += h + QR_IMAGE.gap
  }
  if (input.billLine && input.billLine !== '') centred(input.billLine, false, 14, SHARE_COLORS.soft)
  if (input.payeeName !== '') centred(input.payeeName, true, 20, SHARE_COLORS.ink)
  if (input.bankLabel !== '') centred(input.bankLabel, false, 14, SHARE_COLORS.soft)
  y += QR_IMAGE.gap / 2
  const modules = matrix.length + 2 * QR_IMAGE.quietModules
  const cell = Math.max(1, Math.floor(QR_IMAGE.qrSide / modules))
  const side = cell * modules
  ops.push({ op: 'modules', x: Math.round((W - side) / 2), y, cell, matrix })
  y += side + QR_IMAGE.gap
  if (input.amountLine !== '') centred(input.amountLine, true, 18, SHARE_COLORS.ink)
  return { width: W, height: Math.ceil(y - QR_IMAGE.gap / 2 + QR_IMAGE.pad), ops }
}

export type LoadLogo = (dataUrl: string) => Promise<{ img: unknown; w: number; h: number } | null>
export const browserLoadLogo: LoadLogo = (dataUrl) => new Promise((res) => {
  if (typeof Image === 'undefined' || !dataUrl.startsWith('data:image/')) { res(null); return }
  const im = new Image()
  im.onload = () => res({ img: im, w: im.naturalWidth, h: im.naturalHeight })
  im.onerror = () => res(null)
  im.src = dataUrl
})

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)

/** The finished PNG, or null when the URL cannot be encoded. A broken logo is skipped (text only). */
export async function composeQrImage(input: QrImageInput, make: CanvasFactory = browserCanvas, loadLogo: LoadLogo = browserLoadLogo): Promise<{ bytes: Uint8Array; fileName: string } | null> {
  const matrix = qrModel(input.url)
  if (!matrix) return null
  const logo = input.logoDataUrl ? await loadLogo(input.logoDataUrl).catch(() => null) : null
  const probe = make(1, 1).getContext('2d')
  if (!probe) throw new ShareError('NO_CANVAS', 'This browser cannot draw the picture.')
  const measure: MeasureText = (t, bold, size) => { probe.font = fontCss(bold, size); return probe.measureText(t).width }
  const l = layoutQrImage(input, matrix, measure, logo ? { w: logo.w, h: logo.h } : null)
  const scale = pickScale(l.width, l.height)
  const canvas = make(Math.ceil(l.width * scale), Math.ceil(l.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ShareError('NO_CANVAS', 'This browser cannot draw the picture.')
  ctx.fillStyle = SHARE_COLORS.paper
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.save(); ctx.scale(scale, scale)
  draw(ctx, l, logo?.img ?? null)
  ctx.restore()
  const blob = await canvasBlob(canvas, 'image/png')
  const name = slug(input.billLine ?? '') || slug(input.payeeName) || 'payment'
  return { bytes: await blobBytes(blob), fileName: `qr-${name}.png` }
}

function draw(ctx: Ctx2D, l: QrLayout, logoImg: unknown): void {
  ctx.textBaseline = 'top'
  for (const o of l.ops) {
    if (o.op === 'text') { ctx.font = fontCss(o.bold, o.sizePx); ctx.fillStyle = o.color; ctx.fillText(o.text, o.x, o.y) }
    else if (o.op === 'logo') { if (logoImg) ctx.drawImage(logoImg, o.x, o.y, o.w, o.h) }
    else {
      const q = QR_IMAGE.quietModules * o.cell, n = o.matrix.length
      ctx.fillStyle = SHARE_COLORS.paper
      ctx.fillRect(o.x, o.y, (n * o.cell) + 2 * q, (n * o.cell) + 2 * q)
      ctx.fillStyle = SHARE_COLORS.ink
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (o.matrix[r]![c]) ctx.fillRect(o.x + q + c * o.cell, o.y + q + r * o.cell, o.cell, o.cell)
    }
  }
}

/** The port the Payments page uses. */
export function createQrPort(make: CanvasFactory = browserCanvas): QrPort {
  return {
    matrix: qrModel,
    image: async (input) => { await ensureShareFonts().catch(() => false); return composeQrImage(input, make) }
  }
}
