import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveRuntimePaths } from '../runtimePaths'
import { APP_ID, APP_NAME } from '../../shared/appInfo'

const root = join(__dirname, '..', '..', '..')
const yml = readFileSync(join(root, 'electron-builder.yml'), 'utf8')

describe('Phase 64 - runtime paths', () => {
  it('installed: beside the asar; dev: source tree', () => {
    expect(resolveRuntimePaths({ isPackaged: true, resourcesPath: join('I', 'resources'), appPath: join('I', 'resources', 'app.asar') }))
      .toEqual({ resourcesRoot: join('I', 'resources'), migrationsDir: join('I', 'resources', 'migrations') })
    expect(resolveRuntimePaths({ isPackaged: false, resourcesPath: 'E', appPath: 'P' }))
      .toEqual({ resourcesRoot: join('P', 'resources'), migrationsDir: join('P', 'src', 'main', 'db', 'migrations') })
  })
})

describe('Phase 64 - electron-builder.yml (text checks; the schema is checked by electron-builder itself)', () => {
  const has = (re: RegExp): boolean => re.test(yml)
  it('identity matches the app', () => {
    expect(has(new RegExp(`^appId: ${APP_ID.replace(/\./g, '\\.')}$`, 'm'))).toBe(true)
    expect(has(new RegExp(`^productName: ${APP_NAME}$`, 'm'))).toBe(true)
  })
  it('per-user NSIS, no elevation, shortcuts, data kept by default', () => {
    expect(has(/^\s+perMachine: false/m)).toBe(true)
    expect(has(/^\s+oneClick: false/m)).toBe(true)
    expect(has(/^\s+allowElevation: false/m)).toBe(true)
    expect(has(/^\s+createDesktopShortcut: true/m)).toBe(true)
    expect(has(/^\s+createStartMenuShortcut: true/m)).toBe(true)
    expect(has(/^\s+deleteAppDataOnUninstall: false/m)).toBe(true)
    expect(has(/artifactName: Quot3-Setup-\$\{version\}\.\$\{ext\}/)).toBe(true)
  })
  it('native module unpacked; migrations, fonts, icons shipped as real files', () => {
    expect(has(/node_modules\/better-sqlite3\/prebuilds\/win32-x64\.node/)).toBe(true)
    for (const to of ['migrations', 'fonts', 'icons']) expect(has(new RegExp(`to: ${to}$`, 'm')), to).toBe(true)
  })
  it('every referenced source file / folder exists', () => {
    for (const p of ['src/main/db/migrations/meta/_journal.json', 'resources/fonts', 'resources/icons/icon.ico', 'resources/icons/icon-256.png', 'build/installer.nsh']) {
      expect(existsSync(join(root, p)), p).toBe(true)
    }
    expect(has(/include: build\/installer\.nsh/)).toBe(true)
  })
  it('no auto-launch is registered by the app', () => {
    expect(/setLoginItemSettings/.test(readFileSync(join(root, 'src', 'main', 'index.ts'), 'utf8'))).toBe(false)
  })
  it('the uninstall data prompt defaults to No and never runs during an update', () => {
    const nsh = readFileSync(join(root, 'build', 'installer.nsh'), 'utf8')
    expect(nsh).toContain('MB_DEFBUTTON2')
    expect(nsh).toContain('/SD IDNO')
    expect(nsh).toContain('${ifNot} ${isUpdated}')
  })
})
