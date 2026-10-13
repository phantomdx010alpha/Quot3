import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { CONTENT_RECT_SCRIPT, imageViewWidthPx, planCapture } from '../../../shared/print/imageFlow'
import type { Paper } from '../../../shared/types'
import { CHROME, chromeAvailable } from './layoutHarness'

/** Test helpers shared by the Phase 39 image test and the Phase 40 output-gate matrix (real Chromium via Playwright loaded by path). */
export const PW = process.env.QUOT3_PLAYWRIGHT ?? '/opt/npm-tools/node_modules/playwright'
export const imageToolsReady = (): boolean => chromeAvailable() && existsSync(PW)

/** Minimal 8-bit RGB/RGBA PNG decoder (non-interlaced) - enough to find the ink bounding box. */
export function decode(png: Uint8Array): { w: number; h: number; ch: number; px: Uint8Array } {
  const buf = Buffer.from(png)
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), depth = buf[24], type = buf[25]
  if (depth !== 8 || (type !== 2 && type !== 6)) throw new Error(`unsupported PNG ${depth}/${type}`)
  const ch = type === 6 ? 4 : 3
  const idat: Buffer[] = []
  for (let o = 8; o < buf.length;) { const len = buf.readUInt32BE(o), t = buf.toString('ascii', o + 4, o + 8); if (t === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len)); o += 12 + len }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, px = new Uint8Array(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x] as number
      const a = x >= ch ? px[y * stride + x - ch] as number : 0, b = y ? px[(y - 1) * stride + x] as number : 0, c = x >= ch && y ? px[(y - 1) * stride + x - ch] as number : 0
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      px[y * stride + x] = (v + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
    }
  }
  return { w, h, ch, px }
}
export const isInk = (d: ReturnType<typeof decode>, x: number, y: number): boolean => { const i = (y * d.w + x) * d.ch; return (d.px[i] as number) < 235 || (d.px[i + 1] as number) < 235 || (d.px[i + 2] as number) < 235 }
export function inkBox(d: ReturnType<typeof decode>): { l: number; t: number; r: number; b: number } {
  let l = d.w, t = d.h, r = -1, b = -1
  for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) if (isInk(d, x, y)) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y }
  return { l, t, r, b }
}

export interface Shot { png: Uint8Array; plan: NonNullable<ReturnType<typeof planCapture> & { ok: true }>['plan']; rupee: { x: number; y: number; w: number; h: number } | null; fontOk: boolean; ratioDoc: number }
export async function shootHtml(html: string, paper: Paper, sampleName?: string): Promise<Shot> {
  const f = join(mkdtempSync(join(tmpdir(), 'q3i-')), 'p.html')
  writeFileSync(f, html)
  // Playwright is a sandbox tool, not a project dependency: loaded by path, typed loosely.
  const { chromium } = createRequire(import.meta.url)(PW) as { chromium: { launch(o: unknown): Promise<any> } } // eslint-disable-line @typescript-eslint/no-explicit-any
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--allow-file-access-from-files'] })
  try {
    // Phase 72: the plan (and so the scale, 4x by default, lower for a long bill) is made from a 1x measuring page; the capture then runs in a context at EXACTLY that scale, like the app's device emulation.
    const probe = await (await browser.newContext({ viewport: { width: imageViewWidthPx(paper), height: 1200 }, deviceScaleFactor: 1 })).newPage()
    await probe.goto('file://' + f)
    const content = await probe.evaluate(CONTENT_RECT_SCRIPT)
    const p = planCapture(content)
    if (!p.ok) throw new Error(p.message)
    const page = await (await browser.newContext({ viewport: { width: imageViewWidthPx(paper), height: 1200 }, deviceScaleFactor: p.plan.scale })).newPage()
    await page.goto('file://' + f)
    await page.evaluate(CONTENT_RECT_SCRIPT) // fonts ready before the capture
    await page.setViewportSize({ width: p.plan.viewWidth, height: p.plan.viewHeight })
    await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    const rupee = await page.evaluate(`(()=>{const el=[...document.querySelectorAll('.q3p-table td,.q3p-table th')].find(e=>(e.textContent||'').includes('\\u20B9'));if(!el)return null;const r=el.getBoundingClientRect();return {x:r.left,y:r.top+window.scrollY,w:r.width,h:r.height}})()`) as Shot['rupee']
    const fontOk = await page.evaluate(`document.fonts.check('700 12px "Quot3 Noto Sans"','\\u20B9')`) as boolean
    const ratioDoc = await page.evaluate('document.documentElement.scrollHeight') as number
    const png = await page.screenshot({ clip: { x: p.plan.rect.x, y: p.plan.rect.y, width: p.plan.rect.width, height: p.plan.rect.height }, scale: 'device', fullPage: true })
    if (sampleName && process.env.QUOT3_IMAGE_SAMPLES) writeFileSync(join(process.env.QUOT3_IMAGE_SAMPLES, `${sampleName}.png`), png) // owner-review samples
    return { png: new Uint8Array(png), plan: p.plan, rupee, fontOk, ratioDoc }
  } finally { await browser.close() }
}

