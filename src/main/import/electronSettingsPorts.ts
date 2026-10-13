import { BrowserWindow, dialog } from 'electron'
import type { SettingsPorts } from '../services/appSettingsService'

/** Phase 48 - the native pieces of Settings (logo Open dialog, installed printers). Electron only; not unit tested. */
export function createElectronSettingsPorts(): SettingsPorts {
  return {
    async pickLogo() {
      const opts: Electron.OpenDialogOptions = { title: 'Choose your company logo', properties: ['openFile'], filters: [{ name: 'PNG or JPEG image', extensions: ['png', 'jpg', 'jpeg'] }] }
      const win = BrowserWindow.getFocusedWindow()
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      return res.canceled || res.filePaths.length === 0 ? null : (res.filePaths[0] ?? null)
    },
    async listPrinters() {
      const wc = BrowserWindow.getAllWindows()[0]?.webContents
      if (!wc) return []
      return (await wc.getPrintersAsync()).map((p) => p.name)
    }
  }
}
