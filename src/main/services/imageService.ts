import { createHash } from 'node:crypto'
import type { Bill, Paper, PrintMode } from '../../shared/types'
import { imageScalesFor, planCapture, pngSize, verifyScale, type CapturePlan } from '../../shared/print/imageFlow'
import { AppError } from '../ipc/envelope'
import type { Logger } from '../logger'
import type { PrintService } from './printService'

/**
 * Phase 39 - copy as image. Same decision and the same HTML as print/PDF (via `PrintService.resolveOutput`), rendered in an
 * offscreen window, cropped to the content box and put on the clipboard as a PNG. Nothing here imports Electron.
 */
export interface ImageSession {
  /** The content bounding box (header + table) in CSS px, or null when nothing rendered. */
  measureContent(): Promise<unknown>
  /** Capture `plan.rect` at `plan.scale` over the FULL content height and return PNG bytes. */
  capture(plan: CapturePlan): Promise<Uint8Array>
  close(): void
}

export interface ImagePort {
  /** Load `html` in a hidden window as wide as `paper`'s printable width. Rejects when it cannot load. */
  open(html: string, paper: Paper): Promise<ImageSession>
  /** Put PNG bytes on the OS clipboard as an image. */
  writePng(png: Uint8Array): void | Promise<void>
  /** Phase 71: start the pooled hidden window now (no-op when there is none). Never throws. */
  warm?(): void
  /** Phase 71: destroy the pooled window (app quit). */
  dispose?(): void
}

export interface ImageResult {
  width: number
  height: number
  paper: Paper
  /** Phase 71: true when the PNG came from the content-hash cache (no window, no capture). */
  cached?: boolean
  /** Phase 72: the scale the capture was planned at (may be lower than the setting for a long bill) and whether the PNG's real width matched it. */
  scale: number
  scaleApplied: boolean
  /** Dev flag only: where the PNG was also written. */
  debugFile?: string
}

export interface ImageService {
  copy(req: { bill: Bill; mode: PrintMode }): Promise<ImageResult>
  /** Phase 71: render and cache the PNG without touching the clipboard. Silent when busy; resolves `{ cached }` = already warm. */
  prerender(req: { bill: Bill; mode: PrintMode }): Promise<{ cached: boolean; skipped?: boolean }>
  /** Phase 71: start the warm window. */
  warm(): void
  dispose(): void
}

/** Phase 71: cache limits. Entries are LRU; the byte cap keeps a few huge bills from holding memory. */
export const IMAGE_CACHE_MAX_ENTRIES = 4
export const IMAGE_CACHE_MAX_BYTES = 48 * 1024 * 1024

interface CacheEntry { png: Uint8Array; width: number; height: number; paper: Paper; scale: number; scaleApplied: boolean }

/** Cache key = hash of the exact HTML that would be rendered (it already contains bill content, mode, paper and settings) plus the paper. */
/** Phase 72: the wanted scale is part of the key, so changing Image quality can never serve an older, softer PNG. */
export const imageCacheKey = (html: string, paper: Paper, scale = 0): string => createHash('sha256').update(paper).update('\0').update(String(scale)).update('\0').update(html).digest('hex')

export function createImageService(deps: {
  print: Pick<PrintService, 'resolveOutput'>
  port: ImagePort
  /** Phase 72: the owner's Image quality (`image.scale`), read on every render so a Settings change applies at once. */
  getScale?: () => number
  /** Dev flag: also write the PNG somewhere and return the path. */
  debugWrite?: ((png: Uint8Array) => string) | undefined
  log?: Pick<Logger, 'warn' | 'info'>
}): ImageService {
  let busy = false
  let working: Promise<unknown> | null = null
  const cache = new Map<string, CacheEntry>()
  const cacheBytes = (): number => { let n = 0; for (const e of cache.values()) n += e.png.byteLength; return n }
  const remember = (key: string, e: CacheEntry): void => {
    cache.delete(key)
    cache.set(key, e)
    while (cache.size > IMAGE_CACHE_MAX_ENTRIES || (cache.size > 1 && cacheBytes() > IMAGE_CACHE_MAX_BYTES)) cache.delete(cache.keys().next().value as string)
  }
  const touch = (key: string): CacheEntry | undefined => {
    const e = cache.get(key)
    if (e) { cache.delete(key); cache.set(key, e) }
    return e
  }

  /** Resolve -> (cache hit | open, measure, capture) -> PNG. Nothing here touches the clipboard. */
  async function render(req: { bill: Bill; mode: PrintMode }): Promise<{ entry: CacheEntry; cached: boolean }> {
    const out = await deps.print.resolveOutput({ bill: req.bill, mode: req.mode })
    const paper: Paper = out.decision.size
    const want = deps.getScale?.() ?? imageScalesFor(4)[0]!
    const key = imageCacheKey(out.html, paper, want)
    const hit = touch(key)
    if (hit) return { entry: hit, cached: true }
    let session: ImageSession | null = null
    try {
      session = await deps.port.open(out.html, paper)
      const plan = planCapture(await session.measureContent(), { scales: imageScalesFor(want) })
      if (!plan.ok) throw new AppError('IMAGE_FAILED', plan.message)
      let png = await session.capture(plan.plan)
      // Phase 72: measure, don't assume - the PNG's real width must be rect width x scale. One retry (the surface may not have repainted at the new scale); then keep what we got and say so.
      let check = verifyScale(png, plan.plan)
      if (!check.ok) {
        png = await session.capture(plan.plan)
        check = verifyScale(png, plan.plan)
        if (!check.ok) deps.log?.warn('Image scale did not apply', { wanted: plan.plan.scale, expectedWidth: check.expectedWidth, actualWidth: check.actualWidth, effectiveScale: Number(check.effectiveScale.toFixed(2)) })
      }
      const size = pngSize(png)
      if (!size) throw new AppError('IMAGE_FAILED', 'The capture did not produce an image')
      if (size.width === 0 || size.height === 0) throw new AppError('IMAGE_FAILED', 'The captured image is empty')
      const entry: CacheEntry = { png, width: size.width, height: size.height, paper, scale: plan.plan.scale, scaleApplied: check.ok }
      remember(key, entry)
      return { entry, cached: false }
    } finally {
      try { session?.close() } catch { /* window already gone */ }
    }
  }

  return {
    async copy(req) {
      // Phase 71: a pre-render that is already running is waited for (its result is then a cache hit) instead of refusing.
      if (working) { try { await working } catch { /* the pre-render's own failure is not this copy's */ } }
      if (busy) throw new AppError('IMAGE_FAILED', 'An image is already being prepared')
      busy = true
      try {
        const { entry, cached } = await render(req)
        await deps.port.writePng(entry.png)
        let debugFile: string | undefined
        if (deps.debugWrite) {
          try { debugFile = deps.debugWrite(entry.png) } catch (e) { deps.log?.warn('Image debug write failed', { err: e instanceof Error ? e.message : String(e) }) }
        }
        return { width: entry.width, height: entry.height, paper: entry.paper, cached, scale: entry.scale, scaleApplied: entry.scaleApplied, ...(debugFile ? { debugFile } : {}) }
      } catch (err) {
        if (err instanceof AppError) throw err
        deps.log?.warn('Copy as image failed', { err: err instanceof Error ? err.message : String(err) })
        throw new AppError('IMAGE_FAILED', `Could not copy the image: ${err instanceof Error ? err.message : 'unknown error'}`)
      } finally {
        busy = false
      }
    },
    async prerender(req) {
      if (busy || working) return { cached: false, skipped: true }
      const p = (async () => {
        try { return (await render(req)).cached } catch (err) {
          deps.log?.info('Image pre-render skipped', { err: err instanceof Error ? err.message : String(err) })
          return false
        }
      })()
      working = p
      try { return { cached: await p } } finally { working = null }
    },
    warm() { try { deps.port.warm?.() } catch { /* best effort */ } },
    dispose() { cache.clear(); try { deps.port.dispose?.() } catch { /* best effort */ } }
  }
}
