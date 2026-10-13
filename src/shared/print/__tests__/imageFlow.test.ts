import { describe, expect, it } from 'vitest'
import type { CapturePlan } from '../imageFlow'
import { captureDiagFields, fitToPlanWidth, zoomCapturePlan, ZOOM_LIMITS, CONTENT_RECT_SCRIPT, cdpCaptureParams, cdpResultUsable, nextClipScale, IMAGE_MAX_PX, IMAGE_PADDING_PX, IMAGE_SCALES, IMAGE_SCALE_RANGE, imageScalesFor, imageToast, planCapture, pngSize, readImageScale, validateImageScale, verifyScale } from '../imageFlow'

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })

describe('Phase 39 - planCapture', () => {
  it('adds the same padding on all four sides', () => {
    const r = planCapture(rect(30, 40, 500, 700))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.rect).toEqual({ x: 30 - IMAGE_PADDING_PX, y: 40 - IMAGE_PADDING_PX, width: 500 + 2 * IMAGE_PADDING_PX, height: 700 + 2 * IMAGE_PADDING_PX })
  })
  it('never starts before the document origin (content flush with the edge)', () => {
    const r = planCapture(rect(0, 0, 400, 300))
    if (!r.ok) throw new Error('expected ok')
    expect(r.plan.rect).toEqual({ x: 0, y: 0, width: 400 + IMAGE_PADDING_PX, height: 300 + IMAGE_PADDING_PX })
  })
  it('uses the default scale 4 when it fits, pixel size = rect x scale, and the view covers the whole rectangle', () => {
    const r = planCapture(rect(20, 20, 500, 1000))
    if (!r.ok) throw new Error('expected ok')
    expect(r.plan.scale).toBe(4)
    expect(r.plan.pixelWidth).toBe(r.plan.rect.width * 4)
    expect(r.plan.pixelHeight).toBe(r.plan.rect.height * 4)
    expect(r.plan.viewHeight).toBe(r.plan.rect.y + r.plan.rect.height)
    expect(r.plan.viewWidth).toBe(r.plan.rect.x + r.plan.rect.width)
  })
  it('drops to scale 2 for a tall bill (still crisp) instead of refusing', () => {
    const r = planCapture(rect(20, 20, 500, 6000))
    if (!r.ok) throw new Error('expected ok')
    expect(r.plan.scale).toBe(2)
    expect(r.plan.pixelHeight).toBeLessThanOrEqual(IMAGE_MAX_PX)
  })
  it('refuses a bill taller than the cap with a clear message - never a silent downscale', () => {
    const r = planCapture(rect(20, 20, 500, 9000))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.message).toMatch(/too long for one image/)
    expect(r.message).toContain('16,000')
  })
  it('exactly at the cap is allowed', () => {
    const r = planCapture(rect(0, 0, 100, 8000 - IMAGE_PADDING_PX), { padding: IMAGE_PADDING_PX })
    expect(r.ok).toBe(true)
  })
  it.each([null, undefined, {}, rect(0, 0, 0, 10), rect(0, 0, 10, 0), rect(NaN, 0, 10, 10), 'x'])('rejects an unusable content rect %#', (bad) => {
    expect(planCapture(bad).ok).toBe(false)
  })
})

describe('Phase 39 - pngSize / toast / script', () => {
  const png = (w: number, h: number): Uint8Array => {
    const b = new Uint8Array(33)
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h)
    return b
  }
  it('reads IHDR dimensions', () => { expect(pngSize(png(1480, 2310))).toEqual({ width: 1480, height: 2310 }) })
  it('rejects non-PNG and short input', () => {
    expect(pngSize(new Uint8Array(40))).toBeNull()
    expect(pngSize(new Uint8Array(3))).toBeNull()
  })
  it('toast shows grouped pixel size', () => { expect(imageToast(1480, 12310)).toBe('Image copied - 1,480 × 12,310 px') })
  it('the measuring script targets the header and table, not the page', () => {
    expect(CONTENT_RECT_SCRIPT).toContain('.q3p-head,.q3p-table')
    expect(CONTENT_RECT_SCRIPT).not.toContain('.q3p-sheet')
  })
})

describe('Phase 72 - image scale setting, fallback list, verification', () => {
  const png = (w: number, h: number): Uint8Array => {
    const b = new Uint8Array(33)
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h)
    return b
  }
  it('range 2 to 5, default 4 (HD); IMAGE_SCALES is the default then each step down', () => {
    expect(IMAGE_SCALE_RANGE).toEqual({ min: 2, max: 5, default: 4 })
    expect([...IMAGE_SCALES]).toEqual([4, 3, 2])
    expect([...imageScalesFor(5)]).toEqual([5, 4, 3, 2])
    expect([...imageScalesFor(2)]).toEqual([2])
    expect([...imageScalesFor(9)]).toEqual([5, 4, 3, 2]) // clamped
  })
  it('readImageScale is tolerant: missing / fractional / out of range / not a number -> 4', () => {
    expect(readImageScale({})).toBe(4)
    expect(readImageScale({ 'image.scale': 5 })).toBe(5)
    expect(readImageScale({ 'image.scale': 2 })).toBe(2)
    for (const bad of [1, 6, 3.5, '5', null, NaN]) expect(readImageScale({ 'image.scale': bad })).toBe(4)
  })
  it('validateImageScale refuses (with the range in the message) instead of clamping', () => {
    expect(validateImageScale(4)).toEqual({ ok: true, value: 4 })
    for (const bad of [1, 6, 4.5, '4', undefined]) expect(validateImageScale(bad)).toMatchObject({ ok: false, message: expect.stringContaining('2 to 5') })
  })
  it('planCapture with a 5x wish: 5x when it fits, else the next step down, else refusal', () => {
    const fits = planCapture(rect(20, 20, 500, 1000), { scales: imageScalesFor(5) })
    if (!fits.ok) throw new Error('expected ok')
    expect(fits.plan.scale).toBe(5)
    expect(fits.plan.pixelWidth).toBe(fits.plan.rect.width * 5)
    const tall = planCapture(rect(20, 20, 500, 3500), { scales: imageScalesFor(5) }) // 3524 tall: 5x=17.6k, 4x=14.1k
    if (!tall.ok) throw new Error('expected ok')
    expect(tall.plan.scale).toBe(4)
    expect(planCapture(rect(20, 20, 500, 9000), { scales: imageScalesFor(5) }).ok).toBe(false)
  })
  it('verifyScale compares the PNG width with rect x scale (1 px of rounding allowed)', () => {
    const plan = { rect: { x: 0, y: 0, width: 524, height: 800 }, pixelWidth: 2096 }
    expect(verifyScale(png(2096, 3200), plan)).toMatchObject({ ok: true, expectedWidth: 2096, actualWidth: 2096, effectiveScale: 4 })
    expect(verifyScale(png(2095, 3200), plan).ok).toBe(true)
    const soft = verifyScale(png(524, 800), plan)
    expect(soft.ok).toBe(false)
    expect(soft.effectiveScale).toBe(1)
    expect(verifyScale(new Uint8Array(40), plan)).toMatchObject({ ok: false, actualWidth: 0 })
  })
})

describe('Phase 105 - DevTools-protocol capture parameters', () => {
  const plan = { rect: { x: 20, y: 24, width: 540, height: 800 }, scale: 4, viewWidth: 560, viewHeight: 824 }
  it('pins the device scale factor to the plan scale at the plan view size, and clips the content rect at clip scale 1', () => {
    const p = cdpCaptureParams(plan)
    expect(p.metrics).toEqual({ width: 560, height: 824, deviceScaleFactor: 4, mobile: false, screenWidth: 560, screenHeight: 824, scale: 1 })
    expect(p.screenshot).toEqual({ format: 'png', fromSurface: true, captureBeyondViewport: false, clip: { x: 20, y: 24, width: 540, height: 800, scale: 1 } })
  })
  it('an explicit clip scale is passed through', () => {
    expect(cdpCaptureParams(plan, 3.2).screenshot.clip.scale).toBe(3.2)
  })
  it('nextClipScale calibrates from the measured width (the owner case: 675 px instead of 2160 -> x3.2)', () => {
    expect(nextClipScale(1, { ok: false, expectedWidth: 2160, actualWidth: 675 })).toBe(3.2)
    expect(nextClipScale(2, { ok: false, expectedWidth: 1000, actualWidth: 500 })).toBe(4)
  })
  it('nextClipScale gives up when already right, unreadable, or out of the sane range', () => {
    expect(nextClipScale(1, { ok: true, expectedWidth: 2160, actualWidth: 2160 })).toBeNull()
    expect(nextClipScale(1, { ok: false, expectedWidth: 2160, actualWidth: 0 })).toBeNull()
    expect(nextClipScale(1, { ok: false, expectedWidth: 10000, actualWidth: 100 })).toBeNull()
    expect(nextClipScale(1, { ok: false, expectedWidth: 100, actualWidth: 10000 })).toBeNull()
    expect(nextClipScale(0, { ok: false, expectedWidth: 100, actualWidth: 50 })).toBeNull()
  })
  it('the corrected clip scale reproduces the expected width for the planner output', () => {
    const planned = planCapture(rect(20, 20, 500, 800), { scales: imageScalesFor(4) })
    if (!planned.ok) throw new Error('expected ok')
    const next = nextClipScale(1, { ok: false, expectedWidth: planned.plan.pixelWidth, actualWidth: Math.round(planned.plan.rect.width * 1.25) })
    expect(Math.round(planned.plan.rect.width * 1.25 * (next ?? 0))).toBeCloseTo(planned.plan.pixelWidth, -1)
  })
})

describe('Phase 105 fix - the DevTools PNG only replaces the working PNG when it is verified and bigger', () => {
  const plan = { rect: { x: 0, y: 0, width: 540, height: 800 }, pixelWidth: 2160 }
  const sized = (w: number, h: number, bytes: number): Uint8Array => { const b = new Uint8Array(bytes); const v = new DataView(b.buffer); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); v.setUint32(16, w); v.setUint32(20, h); return b }
  const fallback = sized(675, 1000, 90_000)
  it('accepts a right-width, larger PNG', () => expect(cdpResultUsable(sized(2160, 3200, 600_000), fallback, plan)).toBe(true))
  it('Phase 127 hotfix: rejects the right-width image whose SHAPE is wrong (the whole window, bill tiny inside)', () => {
    expect(cdpResultUsable(sized(2160, 1700, 900_000), fallback, plan)).toBe(false)
    expect(cdpResultUsable(sized(2160, 3260, 900_000), fallback, plan)).toBe(true) // within 2 %
  })
  it('rejects null, wrong width, and a blank-looking (smaller) PNG', () => {
    expect(cdpResultUsable(null, fallback, plan)).toBe(false)
    expect(cdpResultUsable(sized(675, 1000, 600_000), fallback, plan)).toBe(false)
    expect(cdpResultUsable(sized(2160, 3200, 30_000), fallback, plan)).toBe(false)
  })
})

describe('Phase 121 - page-zoom capture plan, width fitting, diagnostics', () => {
  // The owner's PC: Windows 125%, content 540 CSS px wide, wanted 4x -> 2160 px; the old capture gave 675.
  const planned = planCapture({ x: 12, y: 12, width: 516, height: 300 })
  const plan = (planned as { ok: true; plan: CapturePlan }).plan

  it('the plan the tests use is the 540 x 4 = 2160 case', () => {
    expect(planned.ok).toBe(true)
    expect([plan.rect.width, plan.scale, plan.pixelWidth]).toEqual([540, 4, 2160])
  })
  it('display 125%: zoom 3.2; DIP rect x display scale = the planned pixels', () => {
    const z = zoomCapturePlan(plan, 1.25)!
    expect(z.zoom).toBe(3.2)
    expect(z.rect.width * 1.25).toBeGreaterThanOrEqual(plan.pixelWidth)
    expect(z.rect.width * 1.25).toBeLessThanOrEqual(plan.pixelWidth + 3)
    expect(z.viewWidth).toBeGreaterThanOrEqual(z.rect.x + z.rect.width)
    expect(z.viewHeight).toBeGreaterThanOrEqual(z.rect.y + z.rect.height)
  })
  it('display 100%: zoom = the wanted scale; display 200%: zoom 2', () => {
    expect(zoomCapturePlan(plan, 1)!.zoom).toBe(4)
    expect(zoomCapturePlan(plan, 2)!.zoom).toBe(2)
  })
  it('refused: unknown / junk display scale, zoom out of range, surface too big', () => {
    for (const d of [0, -1, NaN, Infinity]) expect(zoomCapturePlan(plan, d)).toBeNull()
    expect(zoomCapturePlan({ ...plan, scale: 5 }, 0.5)).toBeNull()
    const tall = { ...plan, viewHeight: 5000, rect: { ...plan.rect, height: 4988 } }
    expect(zoomCapturePlan(tall, 1.25)).toBeNull() // 5000 x 3.2 x 1.25 = 20 000 > MAX_SURFACE_PX
  })
  it('fitToPlanWidth: equal / 1 px = ok; bigger (up to 2x) = downscale; smaller, huge, zero = reject', () => {
    expect(fitToPlanWidth(2160, 2160)).toBe('ok')
    expect(fitToPlanWidth(2161, 2160)).toBe('ok')
    expect(fitToPlanWidth(2700, 2160)).toBe('downscale')
    expect(fitToPlanWidth(675, 2160)).toBe('reject') // the owner's result: never enlarged
    expect(fitToPlanWidth(5000, 2160)).toBe('reject')
    expect(fitToPlanWidth(0, 2160)).toBe('reject')
  })
  it('captureDiagFields lists the facts the owner log needs, and leaves out an empty note', () => {
    const f = captureDiagFields({ tier: 'zoom', wanted: 4, displayScale: 1.25, expectedWidth: 2160, actualWidth: 2160, ok: true })
    expect(f).toEqual({ tier: 'zoom', wantedScale: 4, displayScale: 1.25, expectedWidth: 2160, actualWidth: 2160, ok: true })
    expect(captureDiagFields({ tier: 'devtools', wanted: 4, displayScale: 1.25, expectedWidth: 2160, actualWidth: null, ok: false, note: 'failed' }).note).toBe('failed')
  })
})
