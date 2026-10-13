import { join } from 'node:path'

export interface RuntimePaths {
  /** Folder holding `fonts/` and `icons/` (print fonts are read by file:// URL, so they must be real files, not inside the asar). */
  resourcesRoot: string
  /** Folder holding the SQL migrations + `meta/_journal.json`. */
  migrationsDir: string
}

/**
 * Phase 64 - where shipped files live. Installed: electron-builder `extraResources` copies them beside the asar
 * (`<install>\resources\{fonts,icons,migrations}`). Dev (`npm run dev`): straight from the source tree.
 */
export function resolveRuntimePaths(opts: { isPackaged: boolean; resourcesPath: string; appPath: string }): RuntimePaths {
  return opts.isPackaged
    ? { resourcesRoot: opts.resourcesPath, migrationsDir: join(opts.resourcesPath, 'migrations') }
    : { resourcesRoot: join(opts.appPath, 'resources'), migrationsDir: join(opts.appPath, 'src', 'main', 'db', 'migrations') }
}
