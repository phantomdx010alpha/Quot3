import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, dialog, shell } from 'electron'
import type { PdfFilePort } from '../services/printService'

/**
 * Phase 38 - the Electron half of PDF export: the Windows Save dialog, the file write and "open in the default viewer".
 * Not unit-tested (needs Electron); the service that uses it is tested with a fake port.
 */
export function createElectronPdfFiles(): PdfFilePort {
  let lastDir: string | null = null // the folder of the last PDF saved this session
  return {
    async chooseSavePath(defaultName) {
      const dir = lastDir ?? app.getPath('documents')
      const res = await dialog.showSaveDialog({
        title: 'Save PDF',
        defaultPath: join(dir, defaultName),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        properties: ['showOverwriteConfirmation', 'createDirectory']
      })
      if (res.canceled || !res.filePath) return null
      lastDir = dirname(res.filePath)
      return res.filePath
    },
    write: (path, bytes) => writeFile(path, bytes),
    exists: (path) => existsSync(path),
    open: (path) => shell.openPath(path)
  }
}
