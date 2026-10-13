import { app, BrowserWindow, dialog } from 'electron'
import type { BackupPorts } from '../services/backupService'

/** Phase 50 - the Electron-only parts of backup / restore (native Open dialog, relaunch). Not unit tested. */
export function createElectronBackupPorts(): BackupPorts {
  return {
    async pickFile() {
      const opts: Electron.OpenDialogOptions = {
        title: 'Import a Quot3 backup',
        properties: ['openFile'],
        filters: [{ name: 'Quot3 backup', extensions: ['db'] }, { name: 'All files', extensions: ['*'] }]
      }
      const win = BrowserWindow.getFocusedWindow()
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      return res.canceled || res.filePaths.length === 0 ? null : (res.filePaths[0] ?? null)
    },
    restart() {
      // exit (not quit): the staged change must be applied by the next launch; drafts are autosaved in the database.
      // Phase 66: the e2e suite sets QUOT3_E2E=1 and relaunches the app itself, so no stray second copy is started.
      setTimeout(() => { if (process.env['QUOT3_E2E'] !== '1') app.relaunch(); app.exit(0) }, 400)
    }
  }
}
