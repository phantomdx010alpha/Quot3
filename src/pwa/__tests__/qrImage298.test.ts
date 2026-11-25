import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import qrcode from 'qrcode-generator'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasLike, Ctx2D } from '../share/image'
import { composeQrImage, createQrPort, layoutQrImage, QR_IMAGE, qrModel, wrapText } from '../share/qrImage'
import type { QrImageInput } from '../ui/kit/paymentsModel'

// Phase 298 (planned as 282, M25): QR matrix + branded QR picture. Invented data only. No real UPI app, no real canvas (a recording fake).
const URLS = [
  'upi://pay?pa=demo.shop@testbank&pn=Demo%20Shop&cu=INR',
  'upi://pay?pa=demo.shop@testbank&pn=Demo%20Shop&am=1250.50&cu=INR&tn=PO%2012',
  'upi://pay?pa=merchant.demo@testbank&pn=Demo%20Merchant&mc=5411&am=99&cu=INR'
]
const input = (over: Partial<QrImageInput> = {}): QrImageInput => ({ url: URLS[1]!, payeeName: 'Demo Shop', bankLabel: 'UPI ID: demo.shop@testbank', amountLine: 'Amount: Rs 1,250.50', logoDataUrl: null, ...over })

function fakeCanvas(): { make: (w: number, h: number) => CanvasLike; texts: string[]; rects: number[][]; images: number } {
  const texts: string[] = []; const rects: number[][] = []; const st = { images: 0 }
  const ctx: Ctx2D = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textBaseline: '',
    save() {}, restore() {}, scale() {}, translate() {}, beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {},
    fillRect: (x, y, w, h) => { rects.push([x, y, w, h]) },
    fillText: (t) => { texts.push(t) },
    drawImage: () => { st.images++ },
    measureText: (t) => ({ width: t.length * 8 })
  }
  const make = (w: number, h: number): CanvasLike => ({ width: w, height: h, getContext: () => ctx, toBlob: (cb) => cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })) })
  return { make, texts, rects, get images() { return st.images } }
}

describe('qrModel', () => {
  it('is a square matrix that equals a fresh encode of the same text, for the three URL shapes', () => {
    for (const u of URLS) {
      const m = qrModel(u)!
      expect(m).not.toBeNull()
      const q = qrcode(0, 'H'); q.addData(u); q.make()
      expect(m.length).toBe(q.getModuleCount())
      expect(m.every((r) => r.length === m.length)).toBe(true)
      expect(m[0]!.slice(0, 7)).toEqual([true, true, true, true, true, true, true]) // the finder pattern, top-left
      for (let r = 0; r < m.length; r++) for (let c = 0; c < m.length; c++) expect(m[r]![c]).toBe(q.isDark(r, c))
    }
  })
  it('empty text gives null; different text gives a different picture', () => {
    expect(qrModel('')).toBeNull()
    expect(JSON.stringify(qrModel(URLS[0]!))).not.toBe(JSON.stringify(qrModel(URLS[1]!)))
  })
})

describe('layout', () => {
  const measure = (t: string, _b: boolean, s: number): number => t.length * s * 0.5
  it('wraps a long name instead of cutting it, and every drawn thing stays inside the picture', () => {
    const name = 'Extremely Long Trading Company Name Of The Demo Partnership And Sons Private Limited'
    const l = layoutQrImage(input({ payeeName: name, billLine: 'PO 12 - ' + name }), qrModel(URLS[1]!)!, measure, { w: 400, h: 200 })
    const nameLines = l.ops.filter((o) => o.op === 'text' && o.bold && o.sizePx === 20) as { text: string; x: number }[]
    expect(nameLines.length).toBeGreaterThan(1)
    expect(nameLines.map((o) => o.text).join(' ')).toBe(name)
    for (const o of l.ops) {
      if (o.op === 'text') { expect(o.x).toBeGreaterThanOrEqual(0); expect(o.x + measure(o.text, o.bold, o.sizePx)).toBeLessThanOrEqual(l.width); expect(o.y).toBeLessThan(l.height) }
      else if (o.op === 'logo') { expect(o.w).toBeLessThanOrEqual(QR_IMAGE.logoMaxW); expect(o.h).toBeLessThanOrEqual(QR_IMAGE.logoMaxH) }
      else { const n = o.matrix.length + 2 * QR_IMAGE.quietModules; expect(o.x).toBeGreaterThanOrEqual(0); expect(o.x + n * o.cell).toBeLessThanOrEqual(l.width); expect(o.y + n * o.cell).toBeLessThanOrEqual(l.height) }
    }
  })
  it('no logo = text only; an empty bill line adds nothing; the quiet zone is 4 modules', () => {
    const l = layoutQrImage(input(), qrModel(URLS[0]!)!, measure, null)
    expect(l.ops.some((o) => o.op === 'logo')).toBe(false)
    expect(l.ops.filter((o) => o.op === 'text').length).toBe(3)
    expect(QR_IMAGE.quietModules).toBe(4)
  })
  it('wrapText splits one unbreakable word by characters', () => {
    const lines = wrapText('A'.repeat(100), 100, (s) => s.length * 8)
    expect(lines.join('')).toBe('A'.repeat(100)); expect(lines.length).toBeGreaterThan(1)
  })
})

describe('composeQrImage', () => {
  it('makes a PNG with the payee, labels and amount; the file name has no account data', async () => {
    const f = fakeCanvas()
    const out = (await composeQrImage(input({ billLine: 'PO 12 - Demo Party' }), f.make, async () => null))!
    expect(Array.from(out.bytes)).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(out.fileName).toBe('qr-po-12-demo-party.png')
    expect(f.texts).toEqual(expect.arrayContaining(['Demo Shop', 'UPI ID: demo.shop@testbank', 'Amount: Rs 1,250.50', 'PO 12 - Demo Party']))
    expect(f.rects.length).toBeGreaterThan(100) // the modules
  })
  it('bank mode: only the label is drawn (the caller never passes the number), a good logo is drawn, a broken one is skipped', async () => {
    const a = fakeCanvas()
    await composeQrImage(input({ bankLabel: 'Bank account transfer', logoDataUrl: 'data:image/png;base64,AAAA' }), a.make, async () => ({ img: {}, w: 100, h: 50 }))
    expect(a.images).toBe(1); expect(a.texts.join('|')).not.toMatch(/\d{9,}/)
    const b = fakeCanvas()
    await composeQrImage(input({ logoDataUrl: 'data:image/png;base64,AAAA' }), b.make, async () => { throw new Error('bad') })
    expect(b.images).toBe(0)
  })
  it('an unencodable URL gives null', async () => { expect(await composeQrImage(input({ url: '' }), fakeCanvas().make)).toBeNull() })
  it('the port answers matrix and image, and makes no network request', async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy)
    const port = createQrPort(fakeCanvas().make)
    expect(port.matrix(URLS[0]!)).not.toBeNull()
    expect((await port.image!(input()))!.fileName).toMatch(/^qr-.*\.png$/)
    expect(fetchSpy).not.toHaveBeenCalled(); vi.unstubAllGlobals()
  })
})

describe('source', () => {
  it('qrImage.ts has no remote URL, fetch, eval or XHR; bootstrap plugs the port in', () => {
    const src = readFileSync(resolve(__dirname, '../share/qrImage.ts'), 'utf8')
    expect(src).not.toMatch(/https?:\/\/|fetch\(|XMLHttpRequest|eval\(|new Function/)
    expect(readFileSync(resolve(__dirname, '../ui/bootstrap.ts'), 'utf8')).toContain('setQrPort(createQrPort())')
  })
})
