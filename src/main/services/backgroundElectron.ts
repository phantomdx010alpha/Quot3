import { app, Menu, nativeImage, powerMonitor, Tray } from 'electron'
import type { TrayMenuModel, TrayItemId } from '../../shared/background'
import type { BackgroundPorts } from './backgroundService'

/** The real Electron side of background mode (Phase 161). Not unit tested: needs the owner's Windows PC. */
export function createElectronBackgroundPorts(iconPath: string | undefined, onTrayClick: () => void): BackgroundPorts {
  let tray: Tray | null = null
  return {
    setOpenAtLogin: (open, args) => { app.setLoginItemSettings({ openAtLogin: open, args }) },
    showTray: (model: TrayMenuModel, onAction: (id: TrayItemId) => void) => {
      if (!tray) {
        const img = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
        tray = new Tray(img)
        tray.on('click', onTrayClick)
        tray.on('double-click', onTrayClick)
      }
      tray.setToolTip(model.tooltip)
      tray.setContextMenu(Menu.buildFromTemplate(model.items.map((i) => ({ label: i.label, click: () => onAction(i.id) }))))
    },
    hideTray: () => { tray?.destroy(); tray = null },
    onWake: (cb) => {
      powerMonitor.on('resume', cb)
      powerMonitor.on('unlock-screen', cb)
      return () => { powerMonitor.removeListener('resume', cb); powerMonitor.removeListener('unlock-screen', cb) }
    }
  }
}
