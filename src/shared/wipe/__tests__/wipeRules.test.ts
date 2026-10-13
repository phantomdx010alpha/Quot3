import { describe, expect, it } from 'vitest'
import { defaultWipeOptions, isWipeConfirm, isWipeSafetyFile, normaliseWipeOptions, parsePoStart } from '../wipeRules'
import { backupKindOf, isSafeBackupFile } from '../../backup/backupRules'
import { PUBLISHER, PUBLISHER_EMAIL, PUBLISHER_NAME, publisherMailto } from '../../appInfo'

describe('wipeRules (Phase 90)', () => {
  it('typed confirmation is per level, case and spacing tolerant', () => {
    expect(isWipeConfirm(1, ' start   fresh ')).toBe(true)
    expect(isWipeConfirm(1, 'FACTORY RESET')).toBe(false)
    expect(isWipeConfirm(2, 'factory reset')).toBe(true)
    expect(isWipeConfirm(2, 'RESET')).toBe(false)
  })
  it('PO start: blank = 1, whole numbers only', () => {
    expect(parsePoStart('')).toBe(1)
    expect(parsePoStart(' 250 ')).toBe(250)
    for (const bad of ['0', '-1', '1.5', 'abc', '123456789', '1e3']) expect(parsePoStart(bad)).toBeNull()
  })
  it('options: level 1 ignores folder switches; bad input is null', () => {
    expect(normaliseWipeOptions({ level: 1, poStart: 7, removeBackups: true })).toEqual({ ...defaultWipeOptions(1), poStart: 7 })
    expect(normaliseWipeOptions({ level: 2, poStart: 1, removeBackups: true, removeLogs: true })).toMatchObject({ level: 2, removeBackups: true, removeLogs: true, removeThemes: false })
    for (const bad of [null, 'x', { level: 3, poStart: 1 }, { level: 1, poStart: 0 }, { level: 1, poStart: 1.5 }, { level: 1 }]) expect(normaliseWipeOptions(bad)).toBeNull()
  })
  it('the pre-wipe backup kind is recognised and protected', () => {
    expect(backupKindOf('pre-wipe-20261011-101500.db')).toBe('pre-wipe')
    expect(isSafeBackupFile('pre-wipe-20261011-101500.db')).toBe(true)
    expect(isWipeSafetyFile('pre-wipe-20261011-101500.db')).toBe(true)
    expect(isWipeSafetyFile('manual-20261011-101500.db')).toBe(false)
  })
  it('publisher: display name + email only; installer publisher unchanged', () => {
    expect(PUBLISHER_NAME).toBe('Ankit Shukla')
    expect(PUBLISHER_EMAIL).toBe('phantomdx9@gmail.com')
    expect(PUBLISHER).toBe('Quot3')
    expect(publisherMailto()).toBe('mailto:phantomdx9@gmail.com?subject=Quot3%20feedback')
  })
})
