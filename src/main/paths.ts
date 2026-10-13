import { mkdirSync } from 'node:fs'
import { posix, win32 } from 'node:path'

export interface DataLayout {
  root: string
  db: string
  backups: string
  themes: string
  logs: string
  assets: string
}

export interface PathEnv {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  homedir: string
}

/** %LOCALAPPDATA%\Quot3 on Windows (NOT Roaming); ~/.quot3 on other dev machines. */
export function resolveDataDir({ platform, env, homedir }: PathEnv): string {
  if (platform === 'win32') {
    const base = env['LOCALAPPDATA'] || win32.join(homedir, 'AppData', 'Local')
    return win32.join(base, 'Quot3')
  }
  return posix.join(homedir, '.quot3')
}

export function dataLayout(root: string, platform: NodeJS.Platform = process.platform): DataLayout {
  const p = platform === 'win32' ? win32 : posix
  return {
    root,
    db: p.join(root, 'quot3.db'),
    backups: p.join(root, 'backups'),
    themes: p.join(root, 'themes'),
    logs: p.join(root, 'logs'),
    assets: p.join(root, 'assets')
  }
}

export function ensureDataDirs(layout: DataLayout): void {
  for (const dir of [layout.root, layout.backups, layout.themes, layout.logs, layout.assets]) {
    mkdirSync(dir, { recursive: true })
  }
}
