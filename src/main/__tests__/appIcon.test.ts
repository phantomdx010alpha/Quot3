import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAppIcon } from '../appIcon'

describe('Phase 63 - resolveAppIcon', () => {
  const res = join('R'), app = join('A')
  it('Windows uses the .ico, packaged folder first, then the source tree', () => {
    expect(resolveAppIcon({ resourcesPath: res, appPath: app, platform: 'win32', exists: () => true })).toBe(join('R', 'icons', 'icon.ico'))
    expect(resolveAppIcon({ resourcesPath: res, appPath: app, platform: 'win32', exists: (p) => p.startsWith('A') })).toBe(join('A', 'resources', 'icons', 'icon.ico'))
  })
  it('other platforms use the PNG; a missing file gives undefined (window still opens)', () => {
    expect(resolveAppIcon({ resourcesPath: res, appPath: app, platform: 'linux', exists: () => true })).toBe(join('R', 'icons', 'icon-256.png'))
    expect(resolveAppIcon({ resourcesPath: res, appPath: app, platform: 'win32', exists: () => false })).toBeUndefined()
  })
})
