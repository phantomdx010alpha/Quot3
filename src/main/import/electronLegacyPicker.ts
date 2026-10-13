import { BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { LegacyPicker } from '../ipc/legacyImport'

const open = (opts: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> => {
  const win = BrowserWindow.getFocusedWindow()
  return win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts)
}

/** Phase 86 - the native dialogs for the legacy import (the only Electron part of it; not unit tested). */
export function createElectronLegacyPicker(): LegacyPicker {
  return {
    async pickFolder() {
      const r = await open({ title: 'Choose the folder with the old app\'s bills', properties: ['openDirectory'] })
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },
    async pickFiles() {
      const r = await open({ title: 'Choose old bill files', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Old bill files (.json)', extensions: ['json'] }] })
      return r.canceled || r.filePaths.length === 0 ? null : r.filePaths
    },
    async savePath(defaultName, ext) {
      const opts: Electron.SaveDialogOptions = { title: 'Save the import report', defaultPath: defaultName, filters: [{ name: ext === 'csv' ? 'CSV' : 'Text', extensions: [ext] }] }
      const win = BrowserWindow.getFocusedWindow()
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      return r.canceled || !r.filePath ? null : r.filePath
    }
  }
}

export const writeReportFile = (path: string, text: string): Promise<void> => writeFile(path, text, 'utf8')
