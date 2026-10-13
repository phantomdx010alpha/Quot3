import { BrowserWindow, dialog } from 'electron'
import type { FilePicker } from '../ipc/partyImport'

/** Phase 47 - the native Open dialog for the party import (the only Electron part of it; not unit tested). */
export function createElectronFilePicker(): FilePicker {
  return {
    async pick() {
      const opts: Electron.OpenDialogOptions = {
        title: 'Import parties from Excel',
        properties: ['openFile'],
        filters: [{ name: 'Excel or CSV', extensions: ['xlsx', 'xlsm', 'csv'] }]
      }
      const win = BrowserWindow.getFocusedWindow()
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      return res.canceled || res.filePaths.length === 0 ? null : (res.filePaths[0] ?? null)
    }
  }
}
