import { describe, expect, it } from 'vitest'
import { allShortcuts, findShortcutConflicts } from '../../shortcuts'
import { BACKUP_KEEP_AUTO, BACKUP_KEEP_PRE, backupFileName, backupKindOf, dailyBackupDue, filesToPrune, formatBytes, isResetConfirm, isRestoreConfirm, isSafeBackupFile, localDay } from '../backupRules'

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
    expect(filesToPrune(all, Number.NaN)).toEqual([]) // falls back to the default of 3
    expect(BACKUP_KEEP_AUTO).toBe(3)
    expect(BACKUP_KEEP_PRE).toBe(3)
  })
  it('Phase 275: 14 automatic backups drop to the newest 3', () => {
    const all = Array.from({ length: 14 }, (_, i) => ({ file: `auto-${String(i + 1).padStart(2, '0')}.db`, kind: 'auto' as const, createdAt: `2026-10-${String(i + 1).padStart(2, '0')}` }))
    const doomed = filesToPrune(all)
    expect(doomed).toHaveLength(11)
    expect(doomed).not.toContain('auto-14.db'); expect(doomed).not.toContain('auto-13.db'); expect(doomed).not.toContain('auto-12.db')
    expect(doomed).toContain('auto-11.db'); expect(doomed).toContain('auto-01.db')
  })
  it('Phase 275: each pre-* kind keeps its own newest 3; manual and imported are never listed; one file of a kind stays', () => {
    const f = (file: string, kind: 'pre-wipe' | 'pre-restore' | 'manual' | 'imported', createdAt: string) => ({ file, kind, createdAt })
    const all = [
      ...[1, 2, 3, 4, 5].map((i) => f(`pre-wipe-${i}.db`, 'pre-wipe', `2026-10-0${i}`)),
      f('pre-restore-1.db', 'pre-restore', '2026-09-01'),
      ...[1, 2, 3, 4, 5].map((i) => f(`manual-${i}.db`, 'manual', `2026-08-0${i}`)),
      ...[1, 2, 3, 4, 5].map((i) => f(`imported-${i}.db`, 'imported', `2026-07-0${i}`))
    ]
    expect(filesToPrune(all).sort()).toEqual(['pre-wipe-1.db', 'pre-wipe-2.db'])
    expect(filesToPrune(all, 3, 0)).toEqual(filesToPrune(all, 3, 1)) // a kind is never emptied: 0 is raised to 1
    expect(filesToPrune(all, 3, 0)).not.toContain('pre-wipe-5.db')
    expect(filesToPrune(all, 3, 0)).not.toContain('pre-restore-1.db')
  })
  it('Phase 275: a protected file is never listed; unknown kinds are ignored', () => {
    const all = [1, 2, 3, 4].map((i) => ({ file: `auto-${i}.db`, kind: 'auto' as const, createdAt: `2026-10-0${i}` }))
    expect(filesToPrune(all, 3, 3, ['auto-1.db'])).toEqual([])
    expect(filesToPrune([...all, { file: 'weird.db', kind: 'nope' as never, createdAt: '2020-01-01' }])).toEqual(['auto-1.db'])
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
