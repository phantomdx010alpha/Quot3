import { describe, expect, it, vi } from 'vitest'
import { printFixture } from '../../../shared/__fixtures__/printBills'
import { IMAGE_PADDING_PX } from '../../../shared/print/imageFlow'
import type { CapturePlan } from '../../../shared/print/imageFlow'
import { AppError } from '../../ipc/envelope'
import { createImageService, IMAGE_CACHE_MAX_ENTRIES, imageCacheKey, type ImagePort, type ImageSession } from '../imageService'

const png = (w: number, h: number): Uint8Array => {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h)
  return b
}
const resolved = { html: '<html>X</html>', decision: { size: 'A5' as const }, switchedByMeasure: false }

function setup(o: { content?: unknown; out?: Uint8Array; openErr?: Error; captureErr?: Error; debug?: boolean; scale?: number; widthFactor?: number; log?: boolean } = {}) {
  const close = vi.fn()
  const capture = vi.fn(async (_p: CapturePlan) => { if (o.captureErr) throw o.captureErr; return o.out ?? png(Math.round(_p.pixelWidth * (o.widthFactor ?? 1)), _p.pixelHeight) })
  const session: ImageSession = { measureContent: async () => ('content' in o ? o.content : { x: 20, y: 20, width: 500, height: 800 }), capture, close }
  const open = vi.fn(async () => { if (o.openErr) throw o.openErr; return session })
  const writePng = vi.fn()
  const warm = vi.fn()
  const dispose = vi.fn()
  const port: ImagePort = { open, writePng, warm, dispose }
  let html = resolved.html
  const resolveOutput = vi.fn(async () => ({ ...resolved, html }) as never)
  const warn = vi.fn()
  const svc = createImageService({ print: { resolveOutput }, port, debugWrite: o.debug ? () => '/tmp/x.png' : undefined, ...(o.scale !== undefined ? { getScale: () => o.scale as number } : {}), log: { warn, info: vi.fn() } })
  return { warn, svc, open, capture, writePng, close, resolveOutput, warm, dispose, setHtml: (h: string) => { html = h } }
}
const req = { bill: printFixture('legacy'), mode: 'rough' as const }

describe('Phase 39 - imageService.copy', () => {
  it('captures the final decision\'s HTML at its paper, writes the PNG to the clipboard, reports the real pixel size', async () => {
    const { svc, open, capture, writePng, close } = setup()
    const r = await svc.copy(req)
    expect(open).toHaveBeenCalledWith('<html>X</html>', 'A5')
    const plan = capture.mock.calls[0]![0]
    expect(plan.rect).toEqual({ x: 20 - IMAGE_PADDING_PX, y: 20 - IMAGE_PADDING_PX, width: 500 + 2 * IMAGE_PADDING_PX, height: 800 + 2 * IMAGE_PADDING_PX })
    expect(writePng).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ width: 2096, height: 3296, paper: 'A5', cached: false, scale: 4, scaleApplied: true })
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('asks PrintService for the same output as print (no ack, rules + measured overflow)', async () => {
    const { svc, resolveOutput } = setup()
    await svc.copy({ ...req, mode: 'professional' })
    expect(resolveOutput).toHaveBeenCalledWith({ bill: req.bill, mode: 'professional' })
  })
  it('too-tall content: IMAGE_FAILED with the limit message, nothing captured or copied, window closed', async () => {
    const { svc, capture, writePng, close } = setup({ content: { x: 0, y: 0, width: 500, height: 20000 } })
    await expect(svc.copy(req)).rejects.toMatchObject({ code: 'IMAGE_FAILED', message: expect.stringMatching(/too long for one image/) })
    expect(capture).not.toHaveBeenCalled()
    expect(writePng).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('nothing rendered (null content rect) is IMAGE_FAILED', async () => {
    const { svc, writePng } = setup({ content: null })
    await expect(svc.copy(req)).rejects.toMatchObject({ code: 'IMAGE_FAILED' })
    expect(writePng).not.toHaveBeenCalled()
  })
  it('a load failure becomes IMAGE_FAILED', async () => {
    const { svc } = setup({ openErr: new Error('took too long') })
    await expect(svc.copy(req)).rejects.toMatchObject({ code: 'IMAGE_FAILED', message: expect.stringContaining('took too long') })
  })
  it('a capture failure becomes IMAGE_FAILED, the window is still closed and the clipboard untouched', async () => {
    const { svc, close, writePng } = setup({ captureErr: new Error('gpu') })
    await expect(svc.copy(req)).rejects.toBeInstanceOf(AppError)
    expect(close).toHaveBeenCalledTimes(1)
    expect(writePng).not.toHaveBeenCalled()
  })
  it('bytes that are not a PNG are refused before the clipboard', async () => {
    const { svc, writePng } = setup({ out: new Uint8Array(50) })
    await expect(svc.copy(req)).rejects.toMatchObject({ code: 'IMAGE_FAILED' })
    expect(writePng).not.toHaveBeenCalled()
  })
  it('an empty (0 px) image is refused', async () => {
    const { svc } = setup({ out: png(0, 0) })
    await expect(svc.copy(req)).rejects.toMatchObject({ code: 'IMAGE_FAILED' })
  })
  it('dev flag: also reports the debug PNG path', async () => {
    const { svc } = setup({ debug: true })
    expect((await svc.copy(req)).debugFile).toBe('/tmp/x.png')
  })
  it('a second copy while one is running is refused, and works again afterwards', async () => {
    const { svc } = setup()
    const first = svc.copy(req)
    await expect(svc.copy(req)).rejects.toMatchObject({ code: 'IMAGE_FAILED' })
    await first
    await expect(svc.copy(req)).resolves.toBeTruthy()
  })
})

describe('Phase 71 - content-hash cache, pre-render, warm window', () => {
  it('prerender fills the cache; the next copy of the same bill opens no window and captures nothing, but still writes the clipboard', async () => {
    const { svc, open, capture, writePng } = setup()
    expect(await svc.prerender(req)).toEqual({ cached: false })
    expect(writePng).not.toHaveBeenCalled() // a pre-render never touches the clipboard
    const r = await svc.copy(req)
    expect(r).toMatchObject({ width: 2096, height: 3296, cached: true })
    expect(open).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(writePng).toHaveBeenCalledTimes(1)
  })
  it('a second copy of an unchanged bill is a cache hit; changed content (different HTML) re-renders', async () => {
    const { svc, open, setHtml } = setup()
    expect((await svc.copy(req)).cached).toBe(false)
    expect((await svc.copy(req)).cached).toBe(true)
    setHtml('<html>Y</html>')
    expect((await svc.copy(req)).cached).toBe(false)
    expect(open).toHaveBeenCalledTimes(2)
  })
  it('the cache key includes the paper and the HTML, and is stable', () => {
    expect(imageCacheKey('<a>', 'A5')).toBe(imageCacheKey('<a>', 'A5'))
    expect(imageCacheKey('<a>', 'A5')).not.toBe(imageCacheKey('<a>', 'A4'))
    expect(imageCacheKey('<a>', 'A5')).not.toBe(imageCacheKey('<b>', 'A5'))
  })
  it('the cache is bounded: the oldest entry is evicted past IMAGE_CACHE_MAX_ENTRIES', async () => {
    const { svc, open, setHtml } = setup()
    for (let i = 0; i <= IMAGE_CACHE_MAX_ENTRIES; i++) { setHtml(`<html>${i}</html>`); await svc.copy(req) }
    setHtml('<html>0</html>')
    expect((await svc.copy(req)).cached).toBe(false) // evicted
    expect(open).toHaveBeenCalledTimes(IMAGE_CACHE_MAX_ENTRIES + 2)
  })
  it('a failed render is never cached', async () => {
    const { svc, open } = setup({ content: null })
    await expect(svc.copy(req)).rejects.toMatchObject({ code: 'IMAGE_FAILED' })
    await expect(svc.copy(req)).rejects.toMatchObject({ code: 'IMAGE_FAILED' })
    expect(open).toHaveBeenCalledTimes(2)
  })
  it('prerender is silent: a render failure resolves (not rejects) and a busy service skips', async () => {
    const bad = setup({ content: null })
    await expect(bad.svc.prerender(req)).resolves.toEqual({ cached: false })
    const { svc } = setup()
    const first = svc.copy(req)
    expect(await svc.prerender(req)).toEqual({ cached: false, skipped: true })
    await first
  })
  it('a copy that arrives during a pre-render waits for it and is then a cache hit (no refusal, one window)', async () => {
    const { svc, open } = setup()
    const pre = svc.prerender(req)
    const copy = svc.copy(req)
    await pre
    expect((await copy).cached).toBe(true)
    expect(open).toHaveBeenCalledTimes(1)
  })
  it('warm() and dispose() reach the port; dispose also empties the cache', async () => {
    const { svc, warm, dispose, open } = setup()
    svc.warm()
    expect(warm).toHaveBeenCalledTimes(1)
    await svc.copy(req)
    svc.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect((await svc.copy(req)).cached).toBe(false)
    expect(open).toHaveBeenCalledTimes(2)
  })
  it('copy-click-to-clipboard timing: a cache hit does no render work at all (measured as zero port calls beyond the clipboard write)', async () => {
    const { svc, open, capture, writePng } = setup()
    await svc.prerender(req)
    open.mockClear(); capture.mockClear()
    const t0 = performance.now()
    await svc.copy(req)
    const ms = performance.now() - t0
    expect(open).not.toHaveBeenCalled()
    expect(capture).not.toHaveBeenCalled()
    expect(writePng).toHaveBeenCalledTimes(1)
    expect(ms).toBeLessThan(50) // fake port: this bounds OUR overhead only, not Electron
  })
})

describe('Phase 72 - HD image quality (image.scale)', () => {
  it('the default is 4x: the plan, the capture and the real PNG width all agree (524 css px -> 2096 px)', async () => {
    const { svc, capture } = setup()
    const r = await svc.copy(req)
    expect(capture.mock.calls[0]![0].scale).toBe(4)
    expect(r).toMatchObject({ width: 524 * 4, scale: 4, scaleApplied: true })
  })
  it.each([2, 3, 5])('Image quality %i is used for the capture and gives rect width x %i pixels', async (n) => {
    const { svc, capture } = setup({ scale: n })
    const r = await svc.copy(req)
    expect(capture.mock.calls[0]![0].scale).toBe(n)
    expect(r.width).toBe(524 * n)
  })
  it('a long bill steps down to the largest scale that fits IMAGE_MAX_PX instead of failing, and says which', async () => {
    const { svc } = setup({ scale: 5, content: { x: 20, y: 20, width: 500, height: 4000 } }) // 4024 css px tall: 5x = 20k, 4x = 16.1k, 3x = 12k
    const r = await svc.copy(req)
    expect(r.scale).toBe(3)
    expect(r.height).toBeLessThanOrEqual(16_000)
  })
  it('a bill too long even at 2x is still refused with the limit message (never a silent downscale)', async () => {
    const { svc, writePng } = setup({ scale: 5, content: { x: 0, y: 0, width: 500, height: 9000 } })
    await expect(svc.copy(req)).rejects.toMatchObject({ code: 'IMAGE_FAILED', message: expect.stringMatching(/too long for one image/) })
    expect(writePng).not.toHaveBeenCalled()
  })
  it('measures the output: a PNG that came out at 1x is re-captured once, and if it stays wrong the copy still works but reports scaleApplied=false and logs a warning', async () => {
    const { svc, capture, writePng, warn } = setup({ widthFactor: 0.25 })
    const r = await svc.copy(req)
    expect(capture).toHaveBeenCalledTimes(2)
    expect(r.scaleApplied).toBe(false)
    expect(writePng).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('Image scale did not apply', expect.objectContaining({ wanted: 4, expectedWidth: 2096, actualWidth: 524 }))
  })
  it('a wrong first capture that is right on the retry is accepted without a warning', async () => {
    const { svc, capture, warn } = setup()
    capture.mockImplementationOnce(async (p: CapturePlan) => png(p.rect.width, p.pixelHeight))
    const r = await svc.copy(req)
    expect(capture).toHaveBeenCalledTimes(2)
    expect(r.scaleApplied).toBe(true)
    expect(warn).not.toHaveBeenCalled()
  })
  it('changing Image quality never serves an older PNG: the cache key includes the scale', async () => {
    let scale = 3
    const base = setup()
    const svc = createImageService({ print: { resolveOutput: async () => ({ html: '<html>X</html>', decision: { size: 'A5' as const }, switchedByMeasure: false }) as never }, port: { open: base.open, writePng: base.writePng }, getScale: () => scale })
    expect((await svc.copy(req)).cached).toBe(false)
    expect((await svc.copy(req)).cached).toBe(true)
    scale = 5
    const r = await svc.copy(req)
    expect(r.cached).toBe(false)
    expect(r.scale).toBe(5)
    expect(imageCacheKey('<a>', 'A5', 3)).not.toBe(imageCacheKey('<a>', 'A5', 5))
  })
})
