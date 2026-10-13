import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { BrowserWindow, shell } from 'electron'
import type { Paper } from '../../shared/types'
import { buildElectronPrintOptions, contentWidthPx, MEASURE_SCRIPT, parsePrintMarginType, effectivePrintMethod, PDF_OPTIONS, printDebugLine, printPageSize } from '../../shared/print/printFlow'
import type { PrintPort } from '../services/printService'
import { printViaPdf } from './pdfPrintRoute'

/**
 * Phase 37 - the Electron half of printing: a HIDDEN window loads the very HTML the preview and the measurement use (written
 * to a temp file so the bundled fonts load by file:// URL), then measures it or sends it to the printer. Not unit-tested
 * (needs Electron + a printer); the owner confirms physical output.
 */
const LOAD_TIMEOUT_MS = 20_000

/**
 * Phase 144 follow-up (speed): ONE hidden window is created lazily, reused for every measure / PDF / print job (jobs run one at a
 * time) and destroyed after it has been idle. Creating a BrowserWindow (a renderer process) per job was the biggest wait.
 */
const IDLE_MS = 45_000
let shared: BrowserWindow | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let queue: Promise<unknown> = Promise.resolve()

function newWindow(widthPx: number): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: widthPx,
    height: 1200,
    useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, webSecurity: true, devTools: false }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.on('closed', () => { if (shared === win) shared = null })
  return win
}

function getWindow(widthPx: number): BrowserWindow {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  if (!shared || shared.isDestroyed()) shared = newWindow(widthPx)
  else shared.setContentSize(widthPx, 1200)
  return shared
}

function scheduleIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => { idleTimer = null; if (shared && !shared.isDestroyed()) shared.destroy(); shared = null }, IDLE_MS)
}

/** Create the window and load a blank page now so the first real job does not pay for the process start. Never throws. */
function warmWindow(): void {
  queue = queue.then(() => { try { const w = getWindow(contentWidthPx('A4')); return w.loadURL('about:blank').catch(() => undefined).finally(scheduleIdleClose) } catch { return undefined } })
}

function withWindow<T>(html: string, widthPx: number, fn: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const job = queue.then(async () => {
    const file = join(tmpdir(), `quot3-print-${randomBytes(6).toString('hex')}.html`)
    writeFileSync(file, html, 'utf8')
    const win = getWindow(widthPx)
    const timer = setTimeout(() => { if (!win.isDestroyed()) win.destroy() }, LOAD_TIMEOUT_MS * 3)
    try {
      await Promise.race([
        win.loadFile(file),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Print page took too long to load')), LOAD_TIMEOUT_MS))
      ])
      return await fn(win)
    } catch (e) {
      // A window that timed out or died is not reused.
      if (!win.isDestroyed()) win.destroy()
      shared = null
      throw e
    } finally {
      clearTimeout(timer)
      scheduleIdleClose()
      try { rmSync(file, { force: true }) } catch { /* temp file already gone */ }
    }
  })
  queue = job.then(() => undefined, () => undefined)
  return job
}

export function createElectronPrintPort(): PrintPort {
  const toPdf: PrintPort['toPdf'] = (html, paper: Paper) => port.toPdf(html, paper)
  const port: PrintPort = {
    warm: warmWindow,
    measure: (html, paper: Paper) =>
      withWindow(html, contentWidthPx(paper), async (win) => Number(await win.webContents.executeJavaScript(MEASURE_SCRIPT))),
    // Phase 38: the same hidden window and HTML as printing; `preferCSSPageSize` makes the template's @page size/margins win.
    toPdf: (html, paper: Paper) =>
      withWindow(html, contentWidthPx(paper), async (win) => {
        await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)')
        if (process.env.QUOT3_PRINT_DEBUG === '1') {
          const bottom = Number(await win.webContents.executeJavaScript(MEASURE_SCRIPT))
          console.log(printDebugLine({ action: 'pdf', paper, pageSize: printPageSize(paper), windowWidthPx: contentWidthPx(paper), contentBottomPx: bottom, deviceName: '' }))
        }
        const buf = await win.webContents.printToPDF({ ...PDF_OPTIONS, pageSize: printPageSize(paper), landscape: false })
        return new Uint8Array(buf)
      }),
    print: async (html, o) => {
      const method = effectivePrintMethod(o.method, process.env.QUOT3_PRINT_ROUTE)
      // Phase 144b (default): the full-page PDF opens in the PC's own PDF app; that app's print dialog places the page on the paper.
      if (method === 'viewer') {
        try {
          const dir = join(tmpdir(), 'quot3-print-pdf')
          mkdirSync(dir, { recursive: true })
          for (const f of readdirSync(dir)) { try { if (Date.now() - statSync(join(dir, f)).mtimeMs > 3_600_000) rmSync(join(dir, f), { force: true }) } catch { /* in use */ } }
          const file = join(dir, `bill-${randomBytes(4).toString('hex')}.pdf`)
          writeFileSync(file, await toPdf(html, o.paper))
          if (!existsSync(file)) return { ok: false as const, cancelled: false, reason: 'The PDF could not be written.' }
          // Windows: ask the default PDF app to PRINT the file itself (the right-click > Print action; `PrintTo` when a printer is configured), so no extra click is needed.
          // If that app has no print action (Edge often has none), fall back to simply opening the PDF.
          if (process.platform === 'win32' && (await verbPrint(file, o.deviceName))) return { ok: true as const }
          const err = await shell.openPath(file)
          if (err !== '') return { ok: false as const, cancelled: false, reason: `No PDF app could open the bill (${err}). Install a PDF viewer or choose another print method in Settings > Print.` }
          return { ok: true as const }
        } catch (e) {
          return { ok: false as const, cancelled: false, reason: e instanceof Error ? e.message : 'The PDF could not be opened.' }
        }
      }
      // Phase 144 follow-up: PDF straight to the printer (Sumatra); on any failure fall back to the older HTML print.
      if (method === 'direct') {
        const r = await printViaPdf({
          toPdf,
          writeTemp: (bytes) => { const f = join(mkdtempSync(join(tmpdir(), 'quot3-pdfprint-')), 'bill.pdf'); writeFileSync(f, bytes); return f },
          removeTemp: (f) => rmSync(join(f, '..'), { recursive: true, force: true }),
          printFile: async (f, options) => { const { print } = await import('pdf-to-printer'); await print(f, options) }
        }, html, o)
        if (process.env.QUOT3_PRINT_DEBUG === '1') console.log(`[print-debug] route=pdf paper=${o.paper} ok=${r.ok}${r.ok ? '' : ` reason=${r.reason.slice(0, 120)} (falling back to html print)`}`)
        if (r.ok) return { ok: true as const }
      }
      return htmlPrint(html, o)
    }
  }
  return port
}

function htmlPrint(html: string, o: { paper: Paper; silent: boolean; deviceName: string }): ReturnType<PrintPort['print']> {
  return (
      withWindow(html, contentWidthPx(o.paper), (win) =>
        new Promise((resolve) => {
          // Phase 144 (ii): `none` stays the default; QUOT3_PRINT_MARGIN_TYPE=default|printableArea is an owner paper-test switch only.
          const options = buildElectronPrintOptions({ paper: o.paper, silent: o.silent, deviceName: o.deviceName, marginType: parsePrintMarginType(process.env.QUOT3_PRINT_MARGIN_TYPE) })
          const debug = process.env.QUOT3_PRINT_DEBUG === '1'
          const start = debug ? win.webContents.executeJavaScript(MEASURE_SCRIPT).then((b) => Number(b), () => -1) : Promise.resolve(-1)
          void start.then((bottom) => {
            if (debug) console.log(printDebugLine({ action: 'print', paper: o.paper, pageSize: options.pageSize, marginType: options.margins.marginType, windowWidthPx: contentWidthPx(o.paper), contentBottomPx: bottom, deviceName: o.deviceName }))
            // The template's @page margins are meant to be authoritative (PAPER_ENGINE_RULES §7); whether Electron's print() honours them with marginType 'none' is NOT proven in the sandbox (Phase 144 log).
            win.webContents.print(options, (success, failureReason) => {
              if (success) resolve({ ok: true })
              else resolve({ ok: false, cancelled: /cancel/i.test(failureReason), reason: failureReason })
            })
          })
        })
      )
  )
}

/** Runs the default app's Print / PrintTo verb on the PDF (PowerShell `Start-Process -Verb`). Resolves false when Windows has no such action for PDFs. */
function verbPrint(file: string, printer: string): Promise<boolean> {
  const cmd = printer !== ''
    ? "Start-Process -FilePath $env:Q3_PDF -Verb PrintTo -ArgumentList ('\"' + $env:Q3_PRINTER + '\"') -ErrorAction Stop"
    : 'Start-Process -FilePath $env:Q3_PDF -Verb Print -ErrorAction Stop'
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd], { env: { ...process.env, Q3_PDF: file, Q3_PRINTER: printer }, timeout: 20_000, windowsHide: true }, (err) => resolve(!err))
  })
}
