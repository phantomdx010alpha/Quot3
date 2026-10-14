/**
 * Phase 39 - copy as image, the pure half (no Electron, no DOM). The service measures the CONTENT bounding box in the hidden
 * window (`CONTENT_RECT_SCRIPT`), then `planCapture` turns it into the capture rectangle, the device scale and the
 * resulting pixel size - or refuses when the image would be taller than `IMAGE_MAX_PX` (never a silent downscale).
 */

import type { Paper } from '../types'
import { contentWidthPx } from './printFlow'

/** Uniform padding around the content, in CSS px (the same on all four sides). */
export const IMAGE_PADDING_PX = 12
/** Phase 72: the owner's "Image quality" setting (`image.scale`): a whole device scale factor, 2 (small) to 5 (maximum). Default 4 = HD. */
export const IMAGE_SCALE_KEY = 'image.scale'
export const IMAGE_SCALE_RANGE = { min: 2, max: 5, default: 4 } as const

/** Tolerant read of the stored value: anything that is not a whole number in range is the default. */
export function readImageScale(all: Record<string, unknown>): number {
  const v = all[IMAGE_SCALE_KEY]
  return typeof v === 'number' && Number.isInteger(v) && v >= IMAGE_SCALE_RANGE.min && v <= IMAGE_SCALE_RANGE.max ? v : IMAGE_SCALE_RANGE.default
}

export type ImageScaleCheck = { ok: true; value: number } | { ok: false; message: string }
/** Strict (for saving): refused with a message, never clamped. */
export function validateImageScale(v: unknown): ImageScaleCheck {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < IMAGE_SCALE_RANGE.min || v > IMAGE_SCALE_RANGE.max) {
    return { ok: false, message: `Image quality: choose a whole number from ${IMAGE_SCALE_RANGE.min} to ${IMAGE_SCALE_RANGE.max}.` }
  }
  return { ok: true, value: v }
}

/** Scales tried for a wanted scale: the wanted one first, then each whole step down to 2 (a long bill falls back instead of failing). */
export function imageScalesFor(want: number): readonly number[] {
  const top = Math.min(IMAGE_SCALE_RANGE.max, Math.max(IMAGE_SCALE_RANGE.min, Math.floor(want)))
  const out: number[] = []
  for (let s = top; s >= IMAGE_SCALE_RANGE.min; s--) out.push(s)
  return out
}

/** Device scale factors tried by default, best first (the default setting, then each step down). */
export const IMAGE_SCALES: readonly number[] = imageScalesFor(IMAGE_SCALE_RANGE.default)

export interface ScaleCheck { ok: boolean; expectedWidth: number; actualWidth: number; /** actual / CSS width: the scale that REALLY applied. */ effectiveScale: number }
/** Phase 72: did the device scale factor really apply? Compares the PNG's real pixel width with `plan.pixelWidth` (1 px of rounding allowed). */
export function verifyScale(png: Uint8Array, plan: Pick<CapturePlan, 'pixelWidth' | 'rect'>): ScaleCheck {
  const size = pngSize(png)
  const actualWidth = size?.width ?? 0
  return {
    ok: size !== null && Math.abs(actualWidth - plan.pixelWidth) <= 1,
    expectedWidth: plan.pixelWidth,
    actualWidth,
    effectiveScale: plan.rect.width > 0 ? actualWidth / plan.rect.width : 0
  }
}
/**
 * Phase 105 - the owner's PC (Windows display scaling 125%) ignored the Phase 72 HD request: `webContents.enableDeviceEmulation` +
 * `capturePage` stayed at the display scale (675 px wide instead of 2160). The capture now goes through the DevTools protocol, the
 * way Puppeteer does it: `Emulation.setDeviceMetricsOverride` pins the device scale factor for the page, then
 * `Page.captureScreenshot` with a clip returns clip x factor pixels. These are the pure parameter builders; the Electron port runs them.
 */
export const CLIP_SCALE_LIMITS = { min: 0.25, max: 4 } as const

export interface CdpCaptureParams {
  metrics: { width: number; height: number; deviceScaleFactor: number; mobile: false; screenWidth: number; screenHeight: number; scale: 1 }
  screenshot: { format: 'png'; fromSurface: true; captureBeyondViewport: false; clip: { x: number; y: number; width: number; height: number; scale: number } }
}
/** `clipScale` is 1 for the normal attempt; `nextClipScale` raises/lowers it when the first result measured wrong. */
export function cdpCaptureParams(plan: Pick<CapturePlan, 'rect' | 'scale' | 'viewWidth' | 'viewHeight'>, clipScale = 1): CdpCaptureParams {
  return {
    metrics: { width: plan.viewWidth, height: plan.viewHeight, deviceScaleFactor: plan.scale, mobile: false, screenWidth: plan.viewWidth, screenHeight: plan.viewHeight, scale: 1 },
    screenshot: { format: 'png', fromSurface: true, captureBeyondViewport: false, clip: { x: plan.rect.x, y: plan.rect.y, width: plan.rect.width, height: plan.rect.height, scale: clipScale } }
  }
}
/**
 * Self-calibration: the clip scale that would turn the measured width into the expected one (`current x expected / actual`),
 * or null when the result cannot be corrected (no usable width, already right, or the factor is outside the sane limits).
 */
export function nextClipScale(current: number, check: Pick<ScaleCheck, 'ok' | 'expectedWidth' | 'actualWidth'>): number | null {
  if (check.ok || check.actualWidth <= 0 || check.expectedWidth <= 0 || !(current > 0)) return null
  const next = Number((current * (check.expectedWidth / check.actualWidth)).toFixed(4))
  return next >= CLIP_SCALE_LIMITS.min && next <= CLIP_SCALE_LIMITS.max ? next : null
}

/**
 * Phase 105 fix: may the DevTools-path PNG replace the known-good `capturePage` PNG? Only when its width really matches the plan AND it is
 * larger in bytes than the fallback (the same content at more pixels is always bigger; a blank or failed paint is far smaller).
 */
export function cdpResultUsable(cdp: Uint8Array | null, fallback: Uint8Array, plan: Pick<CapturePlan, 'pixelWidth' | 'rect'>): boolean {
  return cdp !== null && verifyScale(cdp, plan).ok && sameShape(cdp, plan) && cdp.byteLength > fallback.byteLength
}
/**
 * Hotfix (Phase 127): the owner got the WHOLE window (content small in the middle of a big white page) from the zoom method: the width matched
 * the plan but the zoom had not changed the layout. A good capture has the planned SHAPE too: width / height within 2 % of the content
 * rectangle's. Unreadable PNG = not the same shape.
 */
export function sameShape(png: Uint8Array, plan: Pick<CapturePlan, 'rect'>): boolean {
  const s = pngSize(png)
  if (!s || !(s.width > 0) || !(s.height > 0) || !(plan.rect.width > 0) || !(plan.rect.height > 0)) return false
  const want = plan.rect.width / plan.rect.height
  return Math.abs(s.width / s.height - want) <= want * 0.02
}
/** Per-command time limit for the DevTools path: a hidden window may never answer, and a copy must never hang on it. */
export const CDP_COMMAND_TIMEOUT_MS = 5000

/** The tallest/widest image we will produce, in output pixels. */
export const IMAGE_MAX_PX = 16_000

/**
 * The offscreen window is the sheet's printable width PLUS the padding on both sides: the sheet has a fixed width and is
 * centred, so the padding is real viewport the capture can include (a capture rect cannot reach outside the viewport).
 */
export const imageViewWidthPx = (paper: Paper): number => contentWidthPx(paper) + 2 * IMAGE_PADDING_PX

export interface CssRect { x: number; y: number; width: number; height: number }

/**
 * Run in the hidden window after load: waits for fonts, then returns the union of the header and the table (the content,
 * not the page white space) in document CSS px - or null when nothing renders. Rounded outwards so no edge pixel is cut.
 */
export const CONTENT_RECT_SCRIPT = `(async()=>{try{await document.fonts.ready}catch(e){}
const els=[...document.querySelectorAll('.q3p-head,.q3p-table')];
if(!els.length)return null;
let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity;
for(const e of els){const q=e.getBoundingClientRect();if(q.width<=0||q.height<=0)continue;
l=Math.min(l,q.left+window.scrollX);t=Math.min(t,q.top+window.scrollY);r=Math.max(r,q.right+window.scrollX);b=Math.max(b,q.bottom+window.scrollY)}
if(!isFinite(l))return null;
return {x:Math.floor(l),y:Math.floor(t),width:Math.ceil(r)-Math.floor(l),height:Math.ceil(b)-Math.floor(t)}})()`

export interface CapturePlan {
  /** Capture rectangle in CSS px (content + padding, never negative). */
  rect: CssRect
  scale: number
  /** The image size the capture should produce, in pixels. */
  pixelWidth: number
  pixelHeight: number
  /** The window content size needed so the whole rectangle is inside the viewport. */
  viewWidth: number
  viewHeight: number
}

export type CapturePlanResult = { ok: true; plan: CapturePlan } | { ok: false; message: string }

const isRect = (r: unknown): r is CssRect =>
  !!r && typeof r === 'object' && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite((r as Record<string, unknown>)[k])) &&
  (r as CssRect).width > 0 && (r as CssRect).height > 0

/** Content rect -> capture plan. Picks the largest scale whose output fits `IMAGE_MAX_PX`; refuses (clear message) when even the smallest does not. */
export function planCapture(content: unknown, opts: { padding?: number; scales?: readonly number[]; maxPx?: number } = {}): CapturePlanResult {
  if (!isRect(content)) return { ok: false, message: 'The bill could not be laid out for the image (nothing to capture)' }
  const pad = opts.padding ?? IMAGE_PADDING_PX
  const maxPx = opts.maxPx ?? IMAGE_MAX_PX
  const scales = opts.scales ?? IMAGE_SCALES
  const x = Math.max(0, content.x - pad)
  const y = Math.max(0, content.y - pad)
  const rect: CssRect = { x, y, width: content.x + content.width + pad - x, height: content.y + content.height + pad - y }
  const scale = scales.find((s) => Math.max(rect.width, rect.height) * s <= maxPx)
  if (scale === undefined) {
    const smallest = Math.min(...scales)
    return { ok: false, message: `This bill is too long for one image (${Math.round(rect.height * smallest).toLocaleString('en-US')} px tall; the limit is ${maxPx.toLocaleString('en-US')} px). Print or save a PDF instead, or split the bill.` }
  }
  return { ok: true, plan: { rect, scale, pixelWidth: Math.round(rect.width * scale), pixelHeight: Math.round(rect.height * scale), viewWidth: Math.ceil(rect.x + rect.width), viewHeight: Math.ceil(rect.y + rect.height) } }
}

/** Width and height read from a PNG's IHDR chunk, or null when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: dv.getUint32(16), height: dv.getUint32(20) }
}

/** The toast text: "Image copied - 1,480 x 2,310 px". */
export function imageToast(width: number, height: number): string {
  return `Image copied - ${width.toLocaleString('en-US')} × ${height.toLocaleString('en-US')} px`
}

/**
 * Phase 121 - third capture method, no DevTools and no device emulation: the page zoom. `webContents.setZoomFactor(z)` with a window
 * `z` times bigger keeps the CSS layout identical while drawing every CSS px as z device-independent px; `capturePage` then returns
 * DIP x the DISPLAY scale factor (Windows 125% -> 1.25) pixels. With z = wanted scale / display scale the result is the planned width;
 * a result that is bigger is shrunk to the exact planned width (`fitToPlanWidth`), never enlarged.
 */
export const ZOOM_LIMITS = { min: 0.25, max: 6 } as const
/** Largest drawing surface we ask Chromium for, in device pixels (GPU textures are commonly limited to 16 384). */
export const MAX_SURFACE_PX = 16_000

export interface ZoomCapturePlan {
  zoom: number
  /** Window content size in DIP (CSS viewport x zoom, rounded up). */
  viewWidth: number
  viewHeight: number
  /** `capturePage` rectangle in DIP (rounded outwards so the output is never narrower than planned). */
  rect: CssRect
}
/** Null = this plan cannot use the zoom method (unknown display scale, zoom out of range, or the surface would be too big). */
export function zoomCapturePlan(plan: Pick<CapturePlan, 'rect' | 'scale' | 'viewWidth' | 'viewHeight'>, displayScale: number): ZoomCapturePlan | null {
  if (!(displayScale > 0) || !Number.isFinite(displayScale)) return null
  const zoom = Number((plan.scale / displayScale).toFixed(4))
  if (!(zoom >= ZOOM_LIMITS.min && zoom <= ZOOM_LIMITS.max)) return null
  const viewWidth = Math.ceil(plan.viewWidth * zoom)
  const viewHeight = Math.ceil(plan.viewHeight * zoom)
  if (Math.max(viewWidth, viewHeight) * displayScale > MAX_SURFACE_PX) return null
  const x = Math.floor(plan.rect.x * zoom), y = Math.floor(plan.rect.y * zoom)
  const right = Math.min(viewWidth, Math.ceil((plan.rect.x + plan.rect.width) * zoom))
  const bottom = Math.min(viewHeight, Math.ceil((plan.rect.y + plan.rect.height) * zoom))
  return { zoom, viewWidth, viewHeight, rect: { x, y, width: right - x, height: bottom - y } }
}

/** What to do with a captured width: keep it, shrink it to the planned width (never enlarge: no detail to gain), or reject it. */
export function fitToPlanWidth(actual: number, expected: number): 'ok' | 'downscale' | 'reject' {
  if (!(actual > 0) || !(expected > 0)) return 'reject'
  if (Math.abs(actual - expected) <= 1) return 'ok'
  return actual > expected && actual <= expected * 2 ? 'downscale' : 'reject'
}

/** The log line for one capture: the device scale factors the owner's PC really has, and what each method measured. */
export interface CaptureDiag { tier: 'legacy' | 'csszoom' | 'zoom' | 'devtools'; wanted: number; displayScale: number; expectedWidth: number; actualWidth: number | null; ok: boolean; note?: string }
export function captureDiagFields(d: CaptureDiag): Record<string, unknown> {
  return { tier: d.tier, wantedScale: d.wanted, displayScale: d.displayScale, expectedWidth: d.expectedWidth, actualWidth: d.actualWidth, ok: d.ok, ...(d.note ? { note: d.note } : {}) }
}
