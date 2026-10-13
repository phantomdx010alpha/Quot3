import { describe, expect, it } from 'vitest'
import { TRASH_RETENTION_DAYS, UNDO_DELETE_MS } from '../constants'
import { daysLeft, describeTrashItems, EMPTY_TRASH_WORD, formatDeletedAt, formatPurgeIn, isEmptyTrashConfirm, purgeAt, sanitizeRetentionDays, trashCutoff } from '../trash'
import { findShortcutConflicts, matchShortcut, primaryKeys } from '../shortcuts'

const DAY = 86_400_000

describe('trash (pure)', () => {
  it('constants: 30 days retention, 10 s undo offer', () => {
    expect(TRASH_RETENTION_DAYS).toBe(30)
    expect(UNDO_DELETE_MS).toBe(10_000)
  })

  it('purgeAt adds the retention; unparseable dates come back unchanged', () => {
    expect(purgeAt('2026-10-01T00:00:00.000Z')).toBe('2026-10-31T00:00:00.000Z')
    expect(purgeAt('2026-10-01T00:00:00.000Z', 7)).toBe('2026-10-08T00:00:00.000Z')
    expect(purgeAt('garbage')).toBe('garbage')
  })

  it('trashCutoff is now minus the retention', () => {
    expect(trashCutoff(new Date('2026-10-31T00:00:00.000Z'))).toBe('2026-10-01T00:00:00.000Z')
    expect(trashCutoff(new Date('2026-10-31T00:00:00.000Z'), 1)).toBe('2026-10-30T00:00:00.000Z')
  })

  it('daysLeft rounds up, never goes below 0, tolerates garbage', () => {
    const now = new Date('2026-10-10T00:00:00.000Z')
    expect(daysLeft(new Date(now.getTime() + 29.2 * DAY).toISOString(), now)).toBe(30)
    expect(daysLeft(new Date(now.getTime() + 1 * DAY).toISOString(), now)).toBe(1)
    expect(daysLeft(new Date(now.getTime() + 0.1 * DAY).toISOString(), now)).toBe(1)
    expect(daysLeft(now.toISOString(), now)).toBe(0)
    expect(daysLeft(new Date(now.getTime() - 5 * DAY).toISOString(), now)).toBe(0)
    expect(daysLeft('nope', now)).toBe(0)
  })

  it('formatPurgeIn words', () => {
    const now = new Date('2026-10-10T00:00:00.000Z')
    expect(formatPurgeIn(new Date(now.getTime() - DAY).toISOString(), now)).toBe('today')
    expect(formatPurgeIn(new Date(now.getTime() + DAY).toISOString(), now)).toBe('1 day')
    expect(formatPurgeIn(new Date(now.getTime() + 12 * DAY).toISOString(), now)).toBe('12 days')
  })

  it('formatDeletedAt: DD-MM-YY HH:MM in local time, garbage unchanged', () => {
    expect(formatDeletedAt('2026-10-08T10:05:00.000Z')).toMatch(/^\d{2}-\d{2}-26 \d{2}:\d{2}$/)
    expect(formatDeletedAt('x')).toBe('x')
  })

  it('retention setting is made safe', () => {
    expect(sanitizeRetentionDays(45)).toBe(45)
    expect(sanitizeRetentionDays('10')).toBe(10)
    expect(sanitizeRetentionDays(0)).toBe(1)
    expect(sanitizeRetentionDays(99999)).toBe(3650)
    expect(sanitizeRetentionDays(12.9)).toBe(12)
    for (const bad of [undefined, null, 'abc', NaN, '', {}]) expect(sanitizeRetentionDays(bad)).toBe(30)
  })

  it('typed confirmation: EMPTY, trimmed, any case; nothing else', () => {
    expect(EMPTY_TRASH_WORD).toBe('EMPTY')
    for (const ok of ['EMPTY', 'empty', '  Empty ']) expect(isEmptyTrashConfirm(ok)).toBe(true)
    for (const bad of ['', 'EMPT', 'EMPTY!', 'yes']) expect(isEmptyTrashConfirm(bad)).toBe(false)
  })

  it('describeTrashItems', () => {
    expect(describeTrashItems([{ poNumber: 'Q3-0001', partyName: 'Ruby' }])).toBe('Q3-0001 (Ruby)')
    expect(describeTrashItems([{ poNumber: 'Q3-0001', partyName: '' }])).toBe('Q3-0001')
    expect(describeTrashItems([{ poNumber: 'a', partyName: '' }, { poNumber: 'b', partyName: '' }])).toBe('2 bills')
  })

  it('registry: Ctrl+Shift+D = Recently deleted on History, focus-date moved to Ctrl+Shift+E, Ctrl+Z = undo delete on History, no conflicts', () => {
    expect(primaryKeys('history.trash')).toBe('Ctrl+Shift+D')
    expect(primaryKeys('history.undoDelete')).toBe('Ctrl+Z')
    expect(primaryKeys('history.emptyTrash')).toBe('Ctrl+Shift+Delete')
    expect(primaryKeys('create.focusDate')).toBe('Ctrl+Shift+E')
    type Ev = Parameters<typeof matchShortcut>[0]
    const ev = (key: string, init: object): Ev => ({ key, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, ...init }) as unknown as Ev
    expect(matchShortcut(ev('D', { shiftKey: true }), ['history'])?.action).toBe('history.trash')
    expect(matchShortcut(ev('z', {}), ['history'])?.action).toBe('history.undoDelete')
    expect(findShortcutConflicts()).toEqual([])
  })
})
