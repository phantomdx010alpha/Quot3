import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ICON_FILES, pickIconPath } from '../shared/appInfo'

/** Phase 63 - where the window / taskbar icon lives. Packaged: `<resources>/icons` (Phase 64 copies the folder); dev: `<app>/resources/icons`. */
export function resolveAppIcon(opts: { resourcesPath: string; appPath: string; platform: string; exists?: (p: string) => boolean }): string | undefined {
  const file = opts.platform === 'win32' ? ICON_FILES.ico : ICON_FILES.png256
  return pickIconPath(
    [join(opts.resourcesPath, 'icons', file), join(opts.appPath, 'resources', 'icons', file)],
    opts.exists ?? existsSync
  )
}
