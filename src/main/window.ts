import { BrowserWindow, session } from 'electron'
import type { Logger } from './logger'
import { buildCsp, isTrustedUrl, type TrustConfig } from './security'

/** Phase 98: Navy Ember defaults until the renderer reports the active theme (themes.setTitleBar). */
export const DEFAULT_TITLEBAR_OVERLAY = { color: '#0b1424', symbolColor: '#e6ecf7', height: 32 } as const

export interface WindowOptions {
  preloadPath: string
  /** Absolute path to out/renderer/index.html (production). */
  indexHtml: string
  trust: TrustConfig
  isDev: boolean
  log: Logger
  /** Phase 63: absolute path of the window / taskbar icon (.ico on Windows); omitted when the file is not found. */
  iconPath?: string
}

/** CSP via response headers for every response the default session serves. */
export function installSessionSecurity(isDev: boolean): void {
  const ses = session.defaultSession
  const csp = buildCsp(isDev)
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] }
    })
  })
  // The app needs no device/notification/etc. permissions.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
}

export function createMainWindow(opts: WindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 1024,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    // Phase 98: Windows keeps the NATIVE minimize / maximize / close buttons (snap, resize, accessibility unchanged); only the strip is themed.
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { ...DEFAULT_TITLEBAR_OVERLAY } } : {}),
    ...(opts.iconPath ? { icon: opts.iconPath } : {}),
    webPreferences: {
      preload: opts.preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: opts.isDev
    }
  })

  const wc = win.webContents
  // Deny every window.open. Internal print/image windows are created by main directly (Phases 37–39).
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url, opts.trust)) {
      event.preventDefault()
      opts.log.warn('Blocked navigation', { url })
    }
  })
  wc.on('will-attach-webview', (event) => event.preventDefault())

  win.once('ready-to-show', () => win.show())

  if (opts.trust.devUrl) void win.loadURL(opts.trust.devUrl)
  else void win.loadFile(opts.indexHtml)

  return win
}
