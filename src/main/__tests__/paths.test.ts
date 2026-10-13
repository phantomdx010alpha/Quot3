import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dataLayout, ensureDataDirs, resolveDataDir } from '../paths'

describe('paths', () => {
  it('uses %LOCALAPPDATA%\\Quot3 on Windows (not Roaming)', () => {
    const dir = resolveDataDir({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\A\\AppData\\Local', APPDATA: 'C:\\Users\\A\\AppData\\Roaming' },
      homedir: 'C:\\Users\\A'
    })
    expect(dir).toBe('C:\\Users\\A\\AppData\\Local\\Quot3')
  })

  it('falls back to <home>\\AppData\\Local when LOCALAPPDATA is unset', () => {
    expect(resolveDataDir({ platform: 'win32', env: {}, homedir: 'C:\\Users\\A' })).toBe(
      'C:\\Users\\A\\AppData\\Local\\Quot3'
    )
  })

  it('uses ~/.quot3 on non-Windows dev machines', () => {
    expect(resolveDataDir({ platform: 'linux', env: {}, homedir: '/home/dev' })).toBe('/home/dev/.quot3')
  })

  it('layout has the documented folders and db file', () => {
    const l = dataLayout('C:\\Q', 'win32')
    expect(l).toEqual({
      root: 'C:\\Q',
      db: 'C:\\Q\\quot3.db',
      backups: 'C:\\Q\\backups',
      themes: 'C:\\Q\\themes',
      logs: 'C:\\Q\\logs',
      assets: 'C:\\Q\\assets'
    })
  })

  it('ensureDataDirs creates every folder, idempotently', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'q3-')), 'Quot3')
    const l = dataLayout(root)
    ensureDataDirs(l)
    ensureDataDirs(l)
    for (const d of [l.root, l.backups, l.themes, l.logs, l.assets]) expect(existsSync(d)).toBe(true)
  })
})
