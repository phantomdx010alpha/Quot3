import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_ID, APP_NAME, ICON_FILES, ICO_SIZES, PUBLISHER, copyrightLine, formatVersion, parseVersion, pickIconPath } from '../appInfo'

const icons = join(__dirname, '..', '..', '..', 'resources', 'icons')

describe('Phase 63 - app identity', () => {
  it('names and ID', () => {
    expect(APP_NAME).toBe('Quot3')
    expect(PUBLISHER).toBe('Quot3')
    expect(APP_ID).toMatch(/^[a-z0-9]+(\.[a-z0-9]+)+$/)
  })
  it('version scheme', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, beta: null })
    expect(parseVersion('1.2.3-beta.4')).toEqual({ major: 1, minor: 2, patch: 3, beta: 4 })
    for (const bad of ['1.2', 'v1.2.3', '1.2.3-rc.1', '', 7, null]) expect(parseVersion(bad), String(bad)).toBeNull()
    expect(formatVersion('0.1.0')).toBe('Version 0.1.0')
    expect(formatVersion('1.2.3-beta.4')).toBe('Version 1.2.3 (beta 4)')
    expect(formatVersion('')).toBe('Version unknown')
    expect(formatVersion('weird')).toBe('Version weird')
    expect(copyrightLine(2026)).toBe('© 2026 Quot3. All rights reserved.')
  })
  it('pickIconPath returns the first existing candidate', () => {
    expect(pickIconPath(['a', 'b', 'c'], (p) => p !== 'a')).toBe('b')
    expect(pickIconPath(['a'], () => false)).toBeUndefined()
  })
})

describe('Phase 63 - generated icon files', () => {
  it('icon.ico is a valid ICO holding every size 16-256', () => {
    const b = readFileSync(join(icons, ICON_FILES.ico))
    expect(b.readUInt16LE(0)).toBe(0)
    expect(b.readUInt16LE(2)).toBe(1) // type: icon
    const n = b.readUInt16LE(4)
    const sizes: number[] = []
    for (let i = 0; i < n; i++) {
      const o = 6 + i * 16
      const w = b[o]! === 0 ? 256 : b[o]!
      const h = b[o + 1]! === 0 ? 256 : b[o + 1]!
      expect(w).toBe(h)
      const size = b.readUInt32LE(o + 8)
      const offset = b.readUInt32LE(o + 12)
      expect(offset + size).toBeLessThanOrEqual(b.length)
      sizes.push(w)
    }
    expect(sizes.sort((x, y) => x - y)).toEqual([...ICO_SIZES])
  })
  it('PNGs are square RGBA (transparent corners possible) at 256 and 512', () => {
    for (const [file, px] of [[ICON_FILES.png256, 256], [ICON_FILES.png512, 512]] as const) {
      const b = readFileSync(join(icons, file))
      expect(b.subarray(1, 4).toString()).toBe('PNG')
      expect(b.readUInt32BE(16)).toBe(px)
      expect(b.readUInt32BE(20)).toBe(px)
      expect(b[24]).toBe(8) // bit depth
      expect(b[25]).toBe(6) // colour type 6 = RGBA
    }
  })
})
