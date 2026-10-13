import { describe, expect, it } from 'vitest'
import { allShortcuts, findShortcutConflicts } from '../../shortcuts'
import { BACKUP_KEEP_AUTO, backupFileName, backupKindOf, dailyBackupDue, filesToPrune, formatBytes, isResetConfirm, isRestoreConfirm, isSafeBackupFile, localDay } from '../backupRules'

describe('backupRules (Phase 50)', () => {
  it('file names carry the kind and the local time, and parse back', () => {
    const n = backupFileName('manual', new Date(2026, 9, 9, 7, 5, 3))
    expect(n).toBe('manual-20261009-070503.db')
    expect(backupKindOf(n)).toBe('manual')
    expect(backupKindOf('pre-restore-20261009-070503.db')).toBe('pre-restore')
    expect(backupKindOf('pre-migration-v1-to-v2-2026-10-09T01-02-03-000Z.db')).toBe('pre-migration')
    expect(backupKindOf('notes.db')).toBeNull()
    expect(backupKindOf('manual-1.txt')).toBeNull()
  })
  it('only plain file names inside the backups folder are safe', () => {
    for (const bad of ['../manual-1.db', 'a/manual-1.db', 'a\\manual-1.db', 'manual-..db', 'x.db', '']) expect(isSafeBackupFile(bad)).toBe(false)
    expect(isSafeBackupFile('auto-20261009-000000.db')).toBe(true)
  })
  it('pruning removes only the oldest AUTOMATIC backups', () => {
    const f = (file: string, kind: 'auto' | 'manual', createdAt: string) => ({ file, kind, createdAt })
    const all = [f('auto-a.db', 'auto', '2026-10-01'), f('auto-b.db', 'auto', '2026-10-02'), f('auto-c.db', 'auto', '2026-10-03'), f('manual-a.db', 'manual', '2026-09-01')]
    expect(filesToPrune(all, 2)).toEqual(['auto-a.db'])
    expect(filesToPrune(all, 99)).toEqual([])
    expect(filesToPrune(all, Number.NaN)).toEqual([]) // falls back to the default of 14
    expect(BACKUP_KEEP_AUTO).toBe(14)
  })
  it('the daily rule looks at the local calendar day', () => {
    const t = new Date(2026, 9, 9, 8, 0, 0).toISOString()
    expect(localDay(t)).toBe('2026-10-09')
    expect(dailyBackupDue([t], '2026-10-09')).toBe(false)
    expect(dailyBackupDue([t], '2026-10-10')).toBe(true)
    expect(dailyBackupDue([], '2026-10-09')).toBe(true)
    expect(dailyBackupDue(['garbage'], '2026-10-09')).toBe(true)
  })
  it('typed words are case-insensitive and exact; sizes are readable', () => {
    expect(isRestoreConfirm(' restore ')).toBe(true)
    expect(isRestoreConfirm('reset')).toBe(false)
    expect(isResetConfirm('RESET')).toBe(true)
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(-1)).toBe('-')
  })
  it('Ctrl+Alt+B is registered once with no key conflict', () => {
    expect(allShortcuts().filter((s) => s.keys === 'Ctrl+Alt+B')).toHaveLength(1)
    expect(findShortcutConflicts()).toEqual([])
  })
})
