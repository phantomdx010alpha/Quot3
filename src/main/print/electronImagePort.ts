import { randomBytes } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow, clipboard, ClipboardItem, nativeImage, screen } from 'electron'
import type { Paper } from '../../shared/types'
import { captureDiagFields, CDP_COMMAND_TIMEOUT_MS, cdpCaptureParams, cdpResultUsable, CONTENT_RECT_SCRIPT, fitToPlanWidth, imageViewWidthPx, nextClipScale, pngSize, verifyScale, zoomCapturePlan } from '../../shared/print/imageFlow'
import type { CapturePlan } from '../../shared/print/imageFlow'
import { IMAGE_PADDING_PX } from '../../shared/print/imageFlow'
import { isTight, nonWhiteBounds, trimRect } from '../../shared/print/imageTrim'
import type { ImagePort } from '../services/imageService'
import type { Logger } from '../logger'

type CaptureLog = Pick<Logger, 'warn' | 'info'> | undefined

/**
 * Phase 39 - the Electron half of copy-as-image: a HIDDEN sandboxed window loads the print HTML, is resized to the full
 * content height (so nothing is clipped by the viewport), device emulation sets the scale factor, and `capturePage(rect)`
 * grabs only the content box. Not unit-tested (needs Electron); the service is tested with a fake port and the crop maths
 * with real Chromium screenshots. The owner confirms the clipboard paste.
 */
const LOAD_TIMEOUT_MS = 20_000
const nextFrames = 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))'

/**
 * Phase 71 - ONE pooled hidden window is kept alive (spawning a renderer process is the slow part of a cold copy). `open`
 * takes it (or builds it when there is none / it died), `close` wipes the page and returns it instead of destroying it.
 * `warm()` builds it ahead of the first copy; `dispose()` destroys it on quit.
 */
function newWindow(widthPx: number): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: widthPx,
    height: 1200,
    useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, webSecurity: true, devTools: false, offscreen: false, backgroundThrottling: false }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  return win
}

/**
 * Phase 105: DevTools-protocol capture. `Emulation.setDeviceMetricsOverride` forces the device scale factor (independent of the
 * Windows display scale), `Page.captureScreenshot` clips the content box. If the measured width is still wrong it retries once with a
 * calibrated clip scale (`nextClipScale`). Returns the best PNG it got, or null when the debugger is unavailable (caller falls back).
 */
/** Set after the DevTools path failed, timed out or produced an unusable image once: it stays off for the session so a copy never pays that delay again. */
let cdpBroken = false
const withTimeout = <T>(p: Promise<T>, what: string): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), CDP_COMMAND_TIMEOUT_MS))])

async function captureViaCdp(win: BrowserWindow, plan: CapturePlan, log?: CaptureLog): Promise<Uint8Array | null> {
  const dbg = win.webContents.debugger
  let attachedHere = false
  try {
    if (!dbg.isAttached()) { dbg.attach('1.3'); attachedHere = true }
    let clipScale = 1
    let best: Uint8Array | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      const p = cdpCaptureParams(plan, clipScale)
      await withTimeout(dbg.sendCommand('Emulation.setDeviceMetricsOverride', p.metrics), 'setDeviceMetricsOverride')
      await withTimeout(win.webContents.executeJavaScript(nextFrames), 'paint wait') // let the re-scaled surface paint
      const shot = (await withTimeout(dbg.sendCommand('Page.captureScreenshot', p.screenshot), 'captureScreenshot')) as { data?: string }
      if (typeof shot.data !== 'string' || shot.data === '') return best
      best = new Uint8Array(Buffer.from(shot.data, 'base64'))
      const check = verifyScale(best, plan)
      const next = nextClipScale(clipScale, check)
      if (check.ok || next === null) return best
      clipScale = next
    }
    return best
  } catch (e) {
    log?.warn('Image capture: DevTools method failed', { err: e instanceof Error ? e.message : String(e) }) // Phase 121: this used to be swallowed silently
    return null
  } finally {
    if (dbg.isAttached()) {
      try { await withTimeout(dbg.sendCommand('Emulation.clearDeviceMetricsOverride'), 'clearDeviceMetricsOverride') } catch { /* page gone */ }
      if (attachedHere) { try { dbg.detach() } catch { /* already detached */ } }
    }
  }
}

/** Phase 121: set after the zoom method failed or produced an unusable image once; it stays off for the session. */
let zoomBroken = false
/** The display the hidden window is on (its device scale is what `capturePage` multiplies by). */
function displayScaleOf(win: BrowserWindow): number {
  try { return screen.getDisplayMatching(win.getBounds()).scaleFactor } catch { /* no display info */ }
  try { return screen.getPrimaryDisplay().scaleFactor } catch { return 1 }
}

/**
 * Phase 121: page-zoom capture (no DevTools, no emulation). Window = CSS viewport x zoom, `setZoomFactor(zoom)`, `capturePage(rect in DIP)`,
 * then shrink to the exact planned width when the display scale gave more pixels. Returns null when it cannot apply (caller keeps the working PNG).
 */
async function captureViaZoom(win: BrowserWindow, plan: CapturePlan, displayScale: number, log?: CaptureLog): Promise<Uint8Array | null> {
  const z = zoomCapturePlan(plan, displayScale)
  if (!z) return null
  const wc = win.webContents
  try {
    win.setContentSize(z.viewWidth, z.viewHeight)
    wc.setZoomFactor(z.zoom)
    await withTimeout(wc.executeJavaScript(nextFrames), 'paint wait')
    // Hotfix (Phase 127): the zoom must really have changed the layout. With a working zoom the page's CSS viewport is still the planned
    // width; if it is wider the zoom did not apply (owner's copy came out as the whole window with the bill tiny inside) - give up, keep the other methods.
    const cssW = Number(await withTimeout(wc.executeJavaScript('window.innerWidth'), 'viewport check'))
    if (!Number.isFinite(cssW) || Math.abs(cssW - plan.viewWidth) > 2) {
      log?.warn('Image capture: zoom did not change the layout', { cssViewportWidth: cssW, plannedWidth: plan.viewWidth })
      return null
    }
    const img = await withTimeout(wc.capturePage(z.rect, { stayHidden: true }), 'capturePage')
    const mode = fitToPlanWidth(img.getSize().width, plan.pixelWidth)
    if (mode === 'reject') return new Uint8Array(img.toPNG())
    const out = mode === 'downscale' ? img.resize({ width: plan.pixelWidth, quality: 'best' }) : img
    return new Uint8Array(out.toPNG())
  } catch (e) {
    log?.warn('Image capture: zoom method failed', { err: e instanceof Error ? e.message : String(e) })
    return null
  } finally {
    try { wc.setZoomFactor(1) } catch { /* window gone */ }
  }
}

/** Phase 155: set after the CSS-zoom method failed or produced an unusable image once; it stays off for the session. */
let cssZoomBroken = false
/**
 * Phase 155 - HD by drawing the print page bigger, not by asking Chromium for a device scale. The page itself is zoomed with the CSS `zoom`
 * property on the root element (same layout, every CSS px drawn `zoom` DIP wide) in a window that many times bigger, so the text is
 * rasterised at the wanted size on ANY display scale (Windows 100 / 125 / 150 %), with no DevTools and no device emulation (both of which
 * did not take effect on the owner's PC: the copy stayed ~675 px wide). With zoom = wanted scale / display scale the capture is exactly the
 * planned width; a slightly bigger one is shrunk to it, never enlarged. Every result is still checked by the caller (width, shape, no white margin).
 */
async function captureViaCssZoom(win: BrowserWindow, plan: CapturePlan, displayScale: number, log?: CaptureLog): Promise<Uint8Array | null> {
  const z = zoomCapturePlan(plan, displayScale)
  if (!z) return null
  const wc = win.webContents
  try {
    win.setContentSize(z.viewWidth, z.viewHeight)
    await withTimeout(wc.executeJavaScript(`document.documentElement.style.zoom=${JSON.stringify(String(z.zoom))};${nextFrames}`), 'css zoom')
    const img = await withTimeout(wc.capturePage(z.rect, { stayHidden: true }), 'capturePage')
    const mode = fitToPlanWidth(img.getSize().width, plan.pixelWidth)
    if (mode === 'reject') return new Uint8Array(img.toPNG())
    const out = mode === 'downscale' ? img.resize({ width: plan.pixelWidth, quality: 'best' }) : img
    return new Uint8Array(out.toPNG())
  } catch (e) {
    log?.warn('Image capture: CSS zoom method failed', { err: e instanceof Error ? e.message : String(e) })
    return null
  } finally {
    try { await withTimeout(wc.executeJavaScript("document.documentElement.style.zoom=''"), 'css zoom reset') } catch { /* window gone */ }
  }
}

/** Hotfix (Phase 127): does the content (plus its padding) fill this PNG? A big white surface with a small bill inside is NOT tight. */
function pngIsTight(png: Uint8Array): boolean {
  try {
    const img = nativeImage.createFromBuffer(Buffer.from(png))
    const { width, height } = img.getSize()
    return isTight(nonWhiteBounds(img.toBitmap(), width, height), width, height)
  } catch { return true } // cannot judge: do not block a capture on the check itself
}
/** Last line of defence: whatever method produced it, an image that is mostly white margin is cropped to the content + the usual padding. */
function trimLoosePng(png: Uint8Array, plan: CapturePlan, log?: CaptureLog): Uint8Array {
  try {
    const img = nativeImage.createFromBuffer(Buffer.from(png))
    const { width, height } = img.getSize()
    const b = nonWhiteBounds(img.toBitmap(), width, height)
    if (!b || isTight(b, width, height)) return png
    const pad = Math.round(IMAGE_PADDING_PX * (width / Math.max(1, plan.rect.width)))
    const r = trimRect(b, width, height, pad)
    log?.warn('Image capture: result had white margins, trimmed to the content', { width, height, content: b, kept: r })
    return new Uint8Array(img.crop(r).toPNG())
  } catch { return png }
}

export function createElectronImagePort(log?: CaptureLog): ImagePort {
  let pooled: BrowserWindow | null = null
  const take = (widthPx: number): BrowserWindow => {
    const w = pooled && !pooled.isDestroyed() ? pooled : newWindow(widthPx)
    pooled = null
    w.setContentSize(widthPx, 1200)
    return w
  }
  return {
    warm() {
      if (pooled && !pooled.isDestroyed()) return
      try {
        const w = newWindow(imageViewWidthPx('A5'))
        pooled = w
        void w.loadURL('about:blank').catch(() => undefined)
      } catch { pooled = null }
    },
    dispose() {
      if (pooled && !pooled.isDestroyed()) pooled.destroy()
      pooled = null
    },
    async open(html: string, paper: Paper) {
      const widthPx = imageViewWidthPx(paper)
      const file = join(tmpdir(), `quot3-image-${randomBytes(6).toString('hex')}.html`)
      writeFileSync(file, html, 'utf8')
      const win = take(widthPx)
      const cleanup = (): void => {
        try { rmSync(file, { force: true }) } catch { /* already gone */ }
        if (win.isDestroyed()) return
        // Back to the pool: wipe the page (frees the bill's DOM) and keep the process warm. A window that is already pooled wins.
        if (pooled && !pooled.isDestroyed()) { win.destroy(); return }
        try { win.webContents.disableDeviceEmulation() } catch { /* not emulating */ }
        void win.loadURL('about:blank').catch(() => undefined)
        pooled = win
      }
      try {
        await Promise.race([
          win.loadFile(file),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Image page took too long to load')), LOAD_TIMEOUT_MS))
        ])
      } catch (e) {
        // A window that failed to load is not trusted for reuse.
        try { rmSync(file, { force: true }) } catch { /* already gone */ }
        if (!win.isDestroyed()) win.destroy()
        throw e
      }
      const captureRaw = async (plan: CapturePlan): Promise<Uint8Array> => {
          const wc = win.webContents
          win.setContentSize(plan.viewWidth, plan.viewHeight)
          // The ORIGINAL path runs first again (Phase 105 regression: the DevTools path ran first and copy stopped working on the owner's PC).
          wc.enableDeviceEmulation({
            screenPosition: 'desktop',
            screenSize: { width: plan.viewWidth, height: plan.viewHeight },
            viewPosition: { x: 0, y: 0 },
            viewSize: { width: plan.viewWidth, height: plan.viewHeight },
            deviceScaleFactor: plan.scale,
            scale: 1
          })
          await wc.executeJavaScript(nextFrames) // let the resized, re-scaled surface paint before capturing
          const img = await wc.capturePage({ x: plan.rect.x, y: plan.rect.y, width: plan.rect.width, height: plan.rect.height }, { stayHidden: true })
          wc.disableDeviceEmulation()
          const legacy = new Uint8Array(img.toPNG())
          const dsf = displayScaleOf(win)
          const diag = (tier: 'legacy' | 'csszoom' | 'zoom' | 'devtools', png: Uint8Array | null, note?: string): void => {
            const w = png ? pngSize(png)?.width ?? 0 : null
            log?.info('Image capture', captureDiagFields({ tier, wanted: plan.scale, displayScale: dsf, expectedWidth: plan.pixelWidth, actualWidth: w, ok: w !== null && Math.abs(w - plan.pixelWidth) <= 1, ...(note ? { note } : {}) }))
          }
          diag('legacy', legacy)
          if (verifyScale(legacy, plan).ok) return legacy
          // Phase 121: the scale did not apply. Upgrade methods, each time-limited, each MEASURED, each replacing the working PNG only if its
          // width equals the plan and it is bigger in bytes. Order: page zoom (plain Chromium), then the DevTools protocol.
          // Phase 155: the device-independent method goes first among the upgrades (page drawn bigger with CSS zoom).
          if (!cssZoomBroken && zoomCapturePlan(plan, dsf) !== null) {
            const viaCss = await captureViaCssZoom(win, plan, dsf, log)
            diag('csszoom', viaCss, viaCss ? undefined : 'failed')
            if (cdpResultUsable(viaCss, legacy, plan) && pngIsTight(viaCss as Uint8Array)) return viaCss as Uint8Array
            cssZoomBroken = true
          }
          if (!zoomBroken && zoomCapturePlan(plan, dsf) !== null) { // not applicable (e.g. a very tall bill) never switches the method off
            const viaZoom = await captureViaZoom(win, plan, dsf, log)
            diag('zoom', viaZoom, viaZoom ? undefined : 'failed')
            if (cdpResultUsable(viaZoom, legacy, plan) && pngIsTight(viaZoom as Uint8Array)) return viaZoom as Uint8Array
            zoomBroken = true
          }
          if (!cdpBroken) {
            const viaCdp = await captureViaCdp(win, plan, log)
            diag('devtools', viaCdp, viaCdp ? undefined : 'unavailable or failed')
            if (cdpResultUsable(viaCdp, legacy, plan) && pngIsTight(viaCdp as Uint8Array)) return viaCdp as Uint8Array
            cdpBroken = true
          }
          return legacy
      }
      return {
        measureContent: () => win.webContents.executeJavaScript(CONTENT_RECT_SCRIPT) as Promise<unknown>,
        async capture(plan) { return trimLoosePng(await captureRaw(plan), plan, log) },
        close: cleanup
      }
    },
    // Phase 71 / 91: straight from main, no renderer round trip. Electron 44's Clipboard has NO `writeImage` (Phase 71 called it; found by the Phase 91 typecheck):
    // the image goes on the clipboard as one `image/png` ClipboardItem, the same API the grid copy already uses.
    writePng: async (png) => { await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(png)], { type: 'image/png' }) })]) }
  }
}
